import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useTasteStore } from "../stores/tasteStore";
import { useToastStore } from "../stores/toastStore";
import { useAuthStore } from "../stores/authStore";
import { getRecommendation } from "../api/recommend";
import { describeApiError, toApiError } from "../api/client";
import { getCatalogItem, getCatalogItems } from "../api/media";
import { CODE_RE, combinedFavourites } from "../together/protocol";
import type { RoomSnapshot } from "../together/room";
import type { LinkStatus } from "../together/transport";
import { lastRoom, memberId, useRoom } from "../together/useRoom";
import { decodeTaste } from "../utils/tasteLink";
import { sizedPoster } from "../utils/poster";
import PosterArt from "../components/poster/PosterArt";
import { MOOD_DISPLAY_LABELS, MOOD_EMOJIS, type MoodType, type TimeSlot } from "../types/mood";
import type { MediaItem } from "../types/media";
import type { RecommendationResponse } from "../types/recommendation";
import styles from "./TogetherPage.module.css";

const MOODS = Object.keys(MOOD_DISPLAY_LABELS) as MoodType[];
const SLOTS: { key: TimeSlot; label: string }[] = [
  { key: "short", label: "< 1 hr" },
  { key: "medium", label: "~ 2 hrs" },
  { key: "long", label: "All evening" },
];
// Room codes are four characters from an unambiguous alphabet (CODE_RE).
// Anything else on the URL is a legacy taste-link, which we still honour.

function MoodTimePicker({
  mood, slot, onMood, onSlot,
}: {
  mood: MoodType; slot: TimeSlot; onMood: (m: MoodType) => void; onSlot: (s: TimeSlot) => void;
}) {
  return (
    <>
      <fieldset className={styles.picker}>
        <legend className={styles.legend}>What&rsquo;s the mood?</legend>
        <div className={styles.chips}>
          {MOODS.map((m) => (
            <button
              key={m}
              className={`${styles.choice} ${mood === m ? styles.choiceOn : ""}`}
              onClick={() => onMood(m)}
              aria-pressed={mood === m}
            >
              {MOOD_EMOJIS[m]} {MOOD_DISPLAY_LABELS[m]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className={styles.picker}>
        <legend className={styles.legend}>How long have you got?</legend>
        <div className={styles.chips}>
          {SLOTS.map((s) => (
            <button
              key={s.key}
              className={`${styles.choice} ${slot === s.key ? styles.choiceOn : ""}`}
              onClick={() => onSlot(s.key)}
              aria-pressed={slot === s.key}
            >
              {s.label}
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
}

function PickResult({ pick, why, onAgain, againLabel = "Try another" }: { pick: MediaItem; why?: string; onAgain: () => void; againLabel?: string }) {
  return (
    <motion.div
      className={styles.result}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Link to={`/pick/${pick.id}`} className={styles.poster}>
        {pick.poster_path ? <img src={sizedPoster(pick.poster_path, "hero")} alt="" /> : <PosterArt item={pick} />}
      </Link>
      <h2 className={styles.pickTitle}>{pick.title}</h2>
      {why && <p className={styles.why}>{why}</p>}
      <button className={styles.secondary} onClick={onAgain}>{againLabel}</button>
    </motion.div>
  );
}

/** Resolve catalog ids to titles for display (order kept, unknown ids dropped). */
function useTitles(ids: string[]): MediaItem[] {
  const key = ids.join(",");
  const [items, setItems] = useState<MediaItem[]>([]);
  useEffect(() => {
    let live = true;
    if (!key) return;
    getCatalogItems(key.split(",")).then(({ data }) => { if (live) setItems(data.items); }).catch(() => {});
    return () => { live = false; };
  }, [key]);
  return key ? items : [];
}

function VetoPanel({
  veto, memberNames, myId, onVote, onDone,
}: {
  veto: NonNullable<RoomSnapshot["veto"]>;
  memberNames: Map<string, string>;
  myId: string;
  onVote: (id: string | null) => void;
  onDone: () => void;
}) {
  const titles = useTitles(veto.candidates);
  const winner = useTitles(veto.winner ? [veto.winner] : [])[0];
  const myVote = veto.session.votes.get(veto.round)?.get(myId);
  const voted = veto.session.votes.get(veto.round)?.has(myId) ?? false;
  const survivors = new Set(veto.survivors);

  if (veto.winner) {
    return winner ? (
      <PickResult pick={winner} why={`Survived ${veto.round > 1 ? `${veto.round} rounds of` : "the"} vetoes.`} onAgain={onDone} againLabel="Done" />
    ) : null;
  }

  return (
    <section className={styles.veto} aria-label="Veto round">
      <p className={styles.vetoHead}>
        Round {veto.round} · veto one you&rsquo;d rather skip, or keep them all
      </p>
      <ul className={styles.vetoGrid}>
        {titles.map((t) => {
          const out = !survivors.has(t.id);
          return (
            <li key={t.id} className={`${styles.vetoCard} ${out ? styles.vetoOut : ""}`}>
              <div className={styles.vetoPoster}>
                {t.poster_path ? <img src={sizedPoster(t.poster_path, "card")} alt="" /> : <PosterArt item={t} />}
              </div>
              <span className={styles.vetoTitle}>{t.title}</span>
              <button
                className={styles.vetoBtn}
                disabled={voted || out}
                aria-pressed={myVote === t.id}
                onClick={() => onVote(t.id)}
              >
                {myVote === t.id ? "Vetoed" : out ? "Out" : "Veto"}
              </button>
            </li>
          );
        })}
      </ul>
      {voted ? (
        <p className={styles.meta}>
          {veto.waitingOn.length
            ? `Waiting on ${veto.waitingOn.map((id) => memberNames.get(id) ?? "someone").join(", ")}…`
            : "Tallying…"}
        </p>
      ) : (
        <button className={styles.secondary} onClick={() => onVote(null)}>Keep them all</button>
      )}
    </section>
  );
}

const STATUS_COPY: Partial<Record<LinkStatus, string>> = {
  connecting: "Connecting to the room…",
  reconnecting: "Connection dropped. Reconnecting…",
  closed: "Disconnected from the room.",
};

export default function TogetherPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const myIds = useTasteStore((s) => s.favouriteIds);

  const urlCode = code?.toUpperCase();
  const urlIsRoomCode = Boolean(urlCode && CODE_RE.test(urlCode));
  const urlIsLegacy = Boolean(code && !urlIsRoomCode);

  // A signed-in user joins rooms as themselves, so the room shows real names.
  const accountName = useAuthStore((s) =>
    s.user ? (s.user.email ? s.user.email.split("@")[0] : "") : "",
  );
  const [name, setName] = useState(() => localStorage.getItem("unbored-name") || "");
  const effectiveName = name || accountName;
  const [joinCode, setJoinCode] = useState("");
  const [mood, setMood] = useState<MoodType>("thrilled");
  const [slot, setSlot] = useState<TimeSlot>("medium");
  const [working, setWorking] = useState<"pick" | "veto" | null>(null);

  const room = useRoom(effectiveName, myIds);
  const { snap, phase, join } = room;
  const myId = useMemo(() => memberId(), []);

  useEffect(() => {
    if (name.trim()) localStorage.setItem("unbored-name", name.trim());
  }, [name]);

  // Reloading /together/CODE in the room you were in puts you straight back.
  const autoJoined = useRef(false);
  useEffect(() => {
    if (autoJoined.current || !urlIsRoomCode || !room.available) return;
    autoJoined.current = true;
    if (lastRoom()?.code === urlCode) void join(urlCode as string);
  }, [urlIsRoomCode, urlCode, room.available, join]);

  const pickIds = snap?.pick ? [snap.pick.primary_id] : [];
  const pickItem = useTitles(pickIds)[0];

  const handleCreate = async () => {
    const c = await room.create();
    if (c) navigate(`/together/${c}`, { replace: true });
  };

  const handleJoin = async (raw: string) => {
    const c = raw.trim().toUpperCase();
    if (!CODE_RE.test(c)) {
      room.setError("A room code is four letters and numbers.");
      return;
    }
    await join(c);
    if (c !== urlCode) navigate(`/together/${c}`, { replace: true });
  };

  const handleLeave = async () => {
    await room.leave();
    navigate("/together", { replace: true });
  };

  const run = async (kind: "pick" | "veto") => {
    setWorking(kind);
    room.setError(null);
    try {
      if (kind === "pick") await room.pick(mood, slot);
      else await room.startVeto(mood, slot);
    } catch (e) {
      room.setError(describeApiError(toApiError(e)));
    } finally {
      setWorking(null);
    }
  };

  // ── Legacy taste-link: an older /together/<encodedTaste> URL. Keep it
  //    working — those links are already out there — as the original 2-way
  //    blend, rather than a room. ─────────────────────────────────────
  if (urlIsLegacy) {
    return <LegacyBlend encoded={code as string} myIds={myIds} onStartRoom={() => navigate("/together", { replace: true })} />;
  }

  // ── No room service on this deployment ───────────────────────────────
  if (!room.available) {
    return (
      <div className={styles.page}>
        <button className={styles.back} onClick={() => navigate("/")}>← Back</button>
        <h1 className={styles.heading}>Watch together</h1>
        <p className={styles.subtitle}>
          Group rooms need the live room service, and it isn&rsquo;t set up on this copy of Unbored.
          Everything else works as normal.
        </p>
        <Link to="/" className={styles.secondaryLink}>Get a pick for yourself →</Link>
      </div>
    );
  }

  // ── In a room ──────────────────────────────────────────────────────
  if (phase === "in-room" && snap) {
    const shareLink = `${window.location.origin}/together/${snap.code}`;
    const handleShare = async () => {
      try {
        if (navigator.share) await navigator.share({ url: shareLink, title: `Join my watch room: ${snap.code}` });
        else {
          await navigator.clipboard.writeText(shareLink);
          addToast("Invite copied — send it to whoever you're watching with.");
        }
      } catch {
        /* share sheet dismissed */
      }
    };
    const pooled = combinedFavourites(snap.members).length;
    const names = new Map(snap.members.map((m) => [m.member_id, m.member_id === myId ? "you" : m.name]));
    const statusLine = STATUS_COPY[snap.status];

    return (
      <div className={styles.page}>
        <button className={styles.back} onClick={handleLeave}>← Leave room</button>
        <motion.h1 className={styles.heading} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          Watch together
        </motion.h1>

        <div className={styles.roomCode}>
          <span className={styles.codeLabel}>Room code</span>
          <span className={styles.code}>{snap.code}</span>
        </div>
        <button className={styles.secondary} onClick={handleShare}>Share invite</button>
        {statusLine && <p className={styles.status} role="status">{statusLine}</p>}

        <div className={styles.members}>
          {snap.members.map((m) => (
            <span key={m.member_id} className={`${styles.member} ${m.member_id === myId ? styles.memberYou : ""}`}>
              {m.name}
              <span className={styles.memberCount}>{m.favourite_ids.length}</span>
            </span>
          ))}
        </div>
        <p className={styles.meta}>
          {snap.members.length <= 1
            ? "Waiting for others — share the code, or pick now and add more later."
            : `${snap.members.length} in the room · ${pooled} titles pooled`}
        </p>

        {snap.veto ? (
          <VetoPanel veto={snap.veto} memberNames={names} myId={myId} onVote={(id) => void room.vote(id)} onDone={room.endVeto} />
        ) : (
          <>
            <MoodTimePicker mood={mood} slot={slot} onMood={setMood} onSlot={setSlot} />
            <button className={styles.primary} onClick={() => run("pick")} disabled={working !== null || snap.status !== "live"}>
              {working === "pick" ? "Finding common ground…" : "Find something for all of us"}
            </button>
            {snap.members.length > 1 && (
              <button className={styles.secondary} onClick={() => run("veto")} disabled={working !== null || snap.status !== "live"}>
                {working === "veto" ? "Dealing…" : "Veto it out instead"}
              </button>
            )}
          </>
        )}
        {room.error && <p className={styles.error} role="alert">{room.error}</p>}
        {!snap.veto && pickItem && snap.pick && (
          <PickResult
            pick={pickItem}
            why={snap.pick.by && snap.pick.by !== effectiveName ? `${snap.pick.rationale} (picked by ${snap.pick.by})` : snap.pick.rationale}
            onAgain={() => run("pick")}
          />
        )}
      </div>
    );
  }

  // ── Expired / unknown code ───────────────────────────────────────────
  if (phase === "expired") {
    return (
      <div className={styles.page}>
        <button className={styles.back} onClick={() => navigate("/together", { replace: true })}>← Back</button>
        <h1 className={styles.heading}>That room has closed</h1>
        <p className={styles.subtitle}>
          Rooms last twelve hours, and {urlCode ?? "this code"} isn&rsquo;t open any more. Start a new
          one and share the fresh code.
        </p>
        <button className={styles.primary} onClick={handleCreate}>Start a room</button>
      </div>
    );
  }

  const busy = phase === "checking";

  // ── Join prompt for an invite link (short room code in the URL) ──────
  if (urlIsRoomCode) {
    return (
      <div className={styles.page}>
        <button className={styles.back} onClick={() => navigate("/")}>← Back</button>
        <motion.h1 className={styles.heading} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          Join the room
        </motion.h1>
        <p className={styles.subtitle}>
          You&rsquo;ve been invited to room <strong>{urlCode}</strong>. Add your name and
          we&rsquo;ll blend your saved taste with everyone else&rsquo;s. No account needed.
        </p>
        <input
          className={styles.input}
          value={effectiveName}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={24}
          aria-label="Your name"
        />
        <p className={styles.meta}>
          {myIds.length > 0 ? `Bringing your ${myIds.length} favourites` : "You haven't saved any favourites yet — that's fine."}
        </p>
        <button className={styles.primary} onClick={() => handleJoin(urlCode as string)} disabled={busy}>
          {busy ? "Joining…" : "Join room"}
        </button>
        {room.error && <p className={styles.error} role="alert">{room.error}</p>}
        {myIds.length === 0 && <Link to="/browse" className={styles.secondaryLink}>Add a few favourites first →</Link>}
        <p className={styles.hint}>Everyone in the room can see your name and how many favourites you brought.</p>
      </div>
    );
  }

  // ── Landing: start a room, or join one by code ──────────────────────
  return (
    <div className={styles.page}>
      <button className={styles.back} onClick={() => navigate("/")}>← Back</button>
      <motion.h1 className={styles.heading} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        Watch together
      </motion.h1>
      <p className={styles.subtitle}>
        Can&rsquo;t agree on something? Start a room, share the code, and everyone adds what they
        love. We blend it into one pick that suits the whole group, or you can veto it out.
      </p>

      <input
        className={styles.input}
        value={effectiveName}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        maxLength={24}
        aria-label="Your name"
      />

      <button className={styles.primary} onClick={handleCreate} disabled={busy}>
        {busy ? "Starting…" : "Start a room"}
      </button>
      <p className={styles.hint}>
        {myIds.length > 0
          ? `Your ${myIds.length} favourites come with you.`
          : "You can start empty and lean on everyone else's taste."}
      </p>

      <div className={styles.divider}><span>or join one</span></div>

      <div className={styles.joinRow}>
        <input
          className={styles.codeInput}
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          placeholder="CODE"
          maxLength={4}
          aria-label="Room code"
        />
        <button className={styles.secondary} onClick={() => handleJoin(joinCode)} disabled={busy || joinCode.length < 4}>
          Join
        </button>
      </div>
      {room.error && <p className={styles.error} role="alert">{room.error}</p>}
    </div>
  );
}

// The original two-person blend, preserved for links shared before rooms.
function LegacyBlend({ encoded, myIds, onStartRoom }: { encoded: string; myIds: string[]; onStartRoom: () => void }) {
  const theirIds = useMemo(() => decodeTaste(encoded), [encoded]);
  const [theirTitles, setTheirTitles] = useState<MediaItem[]>([]);
  const [mood, setMood] = useState<MoodType>("thrilled");
  const [slot, setSlot] = useState<TimeSlot>("medium");
  const [result, setResult] = useState<RecommendationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    if (!theirIds.length) return;
    Promise.all(theirIds.slice(0, 6).map((id) => getCatalogItem(id).then((r) => r.data).catch(() => null))).then(
      (items) => { if (!cancelled.current) setTheirTitles(items.filter((i): i is MediaItem => i !== null)); },
    );
    return () => { cancelled.current = true; };
  }, [theirIds]);

  const findPick = async () => {
    setLoading(true);
    setError(null);
    try {
      const merged = Array.from(new Set([...theirIds, ...myIds]));
      const res = await getRecommendation({
        favourite_ids: merged, excluded_ids: [], mood, time_available: slot,
        time_of_day: "evening", media_type: "surprise", era: "any",
      });
      setResult(res.data);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  };

  if (!theirIds.length) {
    return (
      <div className={styles.page}>
        <p className={styles.empty}>That invite link doesn&rsquo;t look right.</p>
        <button className={styles.cta} onClick={onStartRoom}>Start a room instead</button>
      </div>
    );
  }

  const pick = result?.primary.media;
  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Watch together</h1>
      <p className={styles.subtitle}>
        Someone shared their taste with you. Add a mood and we&rsquo;ll find one thing that suits you
        both. <button className={styles.linkBtn} onClick={onStartRoom}>Start a group room</button> for more people.
      </p>
      {theirTitles.length > 0 && (
        <div className={styles.tasteRow}>
          {theirTitles.map((t) => <span key={t.id} className={styles.chip}>{t.title}</span>)}
        </div>
      )}
      <MoodTimePicker mood={mood} slot={slot} onMood={setMood} onSlot={setSlot} />
      <button className={styles.primary} onClick={findPick} disabled={loading}>
        {loading ? "Finding common ground…" : "Find something for both of us"}
      </button>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {pick && <PickResult pick={pick} why={result?.rationale} onAgain={findPick} />}
    </div>
  );
}

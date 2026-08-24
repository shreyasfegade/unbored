import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useTasteStore } from "../stores/tasteStore";
import { useToastStore } from "../stores/toastStore";
import { getRecommendation } from "../api/recommend";
import { createRoom, joinRoom, getRoom, roomPick, type RoomState } from "../api/together";
import { describeApiError } from "../api/client";
import { getCatalogItem } from "../api/media";
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
// Room codes are four characters from an unambiguous alphabet. Anything longer
// on the URL is a legacy taste-link, which we still honour below.
const ROOM_CODE_RE = /^[A-Z0-9]{4}$/;

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

function PickResult({ pick, why, onAgain }: { pick: MediaItem; why?: string; onAgain: () => void }) {
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
      <button className={styles.secondary} onClick={onAgain}>Try another</button>
    </motion.div>
  );
}

export default function TogetherPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const myIds = useTasteStore((s) => s.favouriteIds);

  const urlIsRoomCode = Boolean(code && ROOM_CODE_RE.test(code.toUpperCase()));
  const urlIsLegacy = Boolean(code && !urlIsRoomCode);

  const [name, setName] = useState(() => localStorage.getItem("unbored-name") || "");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mood, setMood] = useState<MoodType>("thrilled");
  const [slot, setSlot] = useState<TimeSlot>("medium");
  const [result, setResult] = useState<RecommendationResponse | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (name.trim()) localStorage.setItem("unbored-name", name.trim());
  }, [name]);

  // Poll the room so it feels live as people join. Keyed on the code alone, so
  // it isn't torn down and rebuilt every time a poll updates the member list.
  const roomCode = room?.code;
  useEffect(() => {
    if (!roomCode) return;
    let active = true;
    const id = window.setInterval(async () => {
      try {
        const { data } = await getRoom(roomCode);
        if (active) setRoom(data);
      } catch {
        /* the room lapsed — leave the last known state on screen */
      }
    }, 3000);
    return () => { active = false; window.clearInterval(id); };
  }, [roomCode]);

  const enterRoom = useCallback(
    (next: RoomState, mId: string) => {
      setRoom(next);
      setMemberId(mId);
      setResult(null);
      if (next.code !== code) navigate(`/together/${next.code}`, { replace: true });
    },
    [code, navigate],
  );

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await createRoom(name.trim() || "Host", myIds);
      enterRoom(data.room, data.member_id);
    } catch (e) {
      setError(describeApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async (raw: string) => {
    const c = raw.trim().toUpperCase();
    if (!ROOM_CODE_RE.test(c)) {
      setError("A room code is four letters and numbers.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await joinRoom(c, name.trim() || "Guest", myIds);
      enterRoom(data.room, data.member_id);
    } catch (e) {
      setError(describeApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const shareLink = room ? `${window.location.origin}/together/${room.code}` : "";
  const handleShare = async () => {
    if (!room) return;
    try {
      if (navigator.share) await navigator.share({ url: shareLink, title: `Join my watch room: ${room.code}` });
      else {
        await navigator.clipboard.writeText(shareLink);
        addToast("Invite copied — send it to whoever you're watching with.");
      }
    } catch {
      /* share sheet dismissed */
    }
  };

  const findPick = async () => {
    if (!room) return;
    setPicking(true);
    setError(null);
    try {
      const { data } = await roomPick(room.code, mood, slot);
      setResult(data);
    } catch (e) {
      setError(describeApiError(e));
    } finally {
      setPicking(false);
    }
  };

  // ── Legacy taste-link: an older /together/<encodedTaste> URL. Keep it
  //    working — those links are already out there — as the original 2-way
  //    blend, rather than a room. ─────────────────────────────────────
  if (urlIsLegacy && !room) {
    return <LegacyBlend encoded={code as string} myIds={myIds} onStartRoom={() => navigate("/together", { replace: true })} />;
  }

  // ── In a room ──────────────────────────────────────────────────────
  if (room) {
    const pick = result?.primary.media;
    return (
      <div className={styles.page}>
        <button className={styles.back} onClick={() => { setRoom(null); navigate("/together", { replace: true }); }}>
          ← Leave room
        </button>
        <motion.h1 className={styles.heading} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          Watch together
        </motion.h1>

        <div className={styles.roomCode}>
          <span className={styles.codeLabel}>Room code</span>
          <span className={styles.code}>{room.code}</span>
        </div>
        <button className={styles.secondary} onClick={handleShare}>Share invite</button>

        <div className={styles.members}>
          {room.members.map((m) => (
            <span key={m.id} className={`${styles.member} ${m.id === memberId ? styles.memberYou : ""}`}>
              {m.name}
              <span className={styles.memberCount}>{m.favourite_count}</span>
            </span>
          ))}
        </div>
        <p className={styles.meta}>
          {room.members.length === 1
            ? "Waiting for others — share the code, or pick now and add more later."
            : `${room.members.length} in the room · ${room.combined_favourites} titles pooled`}
        </p>

        <MoodTimePicker mood={mood} slot={slot} onMood={setMood} onSlot={setSlot} />

        <button className={styles.primary} onClick={findPick} disabled={picking}>
          {picking ? "Finding common ground…" : "Find something for all of us"}
        </button>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {pick && <PickResult pick={pick} why={result?.rationale} onAgain={findPick} />}
      </div>
    );
  }

  // ── Join prompt for an invite link (short room code in the URL) ──────
  if (urlIsRoomCode) {
    return (
      <div className={styles.page}>
        <button className={styles.back} onClick={() => navigate("/")}>← Back</button>
        <motion.h1 className={styles.heading} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          Join the room
        </motion.h1>
        <p className={styles.subtitle}>
          You&rsquo;ve been invited to room <strong>{code?.toUpperCase()}</strong>. Add your name and
          we&rsquo;ll blend your saved taste with everyone else&rsquo;s. No account needed.
        </p>
        <input
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={24}
          aria-label="Your name"
        />
        <p className={styles.meta}>
          {myIds.length > 0 ? `Bringing your ${myIds.length} favourites` : "You haven't saved any favourites yet — that's fine."}
        </p>
        <button className={styles.primary} onClick={() => handleJoin(code as string)} disabled={busy}>
          {busy ? "Joining…" : "Join room"}
        </button>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {myIds.length === 0 && <Link to="/browse" className={styles.secondaryLink}>Add a few favourites first →</Link>}
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
        love. We blend it into one pick that suits the whole group.
      </p>

      <input
        className={styles.input}
        value={name}
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
      {error && <p className={styles.error} role="alert">{error}</p>}
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

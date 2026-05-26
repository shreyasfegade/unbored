import { useState, useRef, useCallback } from "react";
import type { YouTubeImportResult } from "../../types/media";
import { uploadYouTube } from "../../api/taste";
import styles from "./YouTubeDropzone.module.css";

interface YouTubeDropzoneProps {
  vectorId: string | null;
  onComplete: (result: YouTubeImportResult) => void;
}

export function YouTubeDropzone({ vectorId, onComplete }: YouTubeDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!vectorId) {
      setError("Create your taste profile first.");
      return;
    }

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "json" && ext !== "html") {
      setError("Make sure it's from Google Takeout (.json or .html).");
      return;
    }

    setError(null);
    setUploading(true);

    try {
      const res = await uploadYouTube(vectorId, file);
      onComplete(res.data);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't read this file."
      );
    } finally {
      setUploading(false);
    }
  }, [vectorId, onComplete]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleBrowse = () => {
    fileInputRef.current?.click();
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className={styles.container}>
      <h3 className={styles.heading}>Import YouTube History</h3>

      <div
        className={`${styles.dropzone} ${isDragging ? styles.dragging : ""} ${uploading ? styles.uploading : ""}`}
        onDragEnter={handleDragIn}
        onDragLeave={handleDragOut}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={!uploading ? handleBrowse : undefined}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleBrowse();
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.html"
          className={styles.fileInput}
          onChange={handleFileInput}
        />
        {uploading ? (
          <div className={styles.progressWrap}>
            <p>Processing your watch history...</p>
            <div className={styles.spinner} />
          </div>
        ) : (
          <>
            <p className={styles.dzText}>Drop your watch-history.json here</p>
            <p className={styles.dzSub}>or click to browse</p>
            <p className={styles.dzHint}>Accepts .json or .html from Google Takeout</p>
          </>
        )}
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}

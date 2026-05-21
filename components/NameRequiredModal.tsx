"use client";

import { useEffect, useRef, useState } from "react";
import ModalPortal from "./ModalPortal";
import { MAX_NAME_LENGTH, validateUserName } from "@/lib/nameValidation";
import { saveUserName } from "@/lib/userProfile";

interface NameRequiredModalProps {
  isOpen: boolean;
  // Called with the trimmed, validated name after `saveUserName` has run.
  // Use this to retry the gated action (vote / create group / etc.).
  onSubmit: (name: string) => void;
  onCancel: () => void;
  message?: string;
  confirmText?: string;
}

export default function NameRequiredModal({
  isOpen,
  onSubmit,
  onCancel,
  message = "Please enter your name to continue.",
  confirmText = "Save",
}: NameRequiredModalProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset + focus on open. Empty start: callers reach this modal precisely
  // because no name was saved, so there's nothing to prefill.
  useEffect(() => {
    if (!isOpen) return;
    setName("");
    const id = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handle);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handle);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const validation = validateUserName(name);
  const canSubmit = validation.ok;
  const errorText = name.length > 0 && !validation.ok ? validation.error : null;

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!validateUserName(trimmed).ok) return;
    saveUserName(trimmed);
    onSubmit(trimmed);
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-black/50 dark:bg-black/70"
          onClick={onCancel}
        />
        <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full px-4 py-4">
          <p className="text-gray-900 dark:text-white mb-3 text-base font-normal text-center">
            {message}
          </p>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            maxLength={MAX_NAME_LENGTH}
            placeholder="Your name"
            className="w-full mb-3 px-3 py-2 text-base bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white focus:outline-none focus:border-blue-500 dark:focus:border-blue-400"
          />
          {errorText && (
            <p className="mb-3 text-sm text-red-600 dark:text-red-400 text-center">
              {errorText}
            </p>
          )}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="px-6 py-2 rounded-lg transition-all active:scale-95 font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

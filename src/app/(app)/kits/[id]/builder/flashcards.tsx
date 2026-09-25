"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { nextId } from "@/kit/edit";
import type { Flashcard, Kit } from "@/kit/schema";
import { inputClass, Section } from "./ui";

export function FlashcardsSection({ kit, update }: { kit: Kit; update: (change: (kit: Kit) => Kit) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const setCards = (change: (cards: Flashcard[]) => Flashcard[]) => update((k) => ({ ...k, flashcards: change(k.flashcards) }));
  const edit = (id: string, patch: Partial<Flashcard>) =>
    setCards((cards) => cards.map((c) => (c.id === id ? { ...c, ...patch, edited: c.origin !== "user" || c.edited } : c)));

  return (
    <Section
      id="flashcards"
      title={`Flashcards (${kit.flashcards.length})`}
      actions={
        <Button
          variant="secondary"
          onClick={() => {
            const id = nextId(kit.flashcards, "f");
            setCards((cards) => [...cards, { id, front: "New card", back: "", requirement_ids: [], origin: "user" }]);
            setEditing(id);
          }}
        >
          + Add card
        </Button>
      }
    >
      {kit.flashcards.length === 0 ? (
        <p className="text-sm text-muted">No flashcards yet. Add one to practise it.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {kit.flashcards.map((card) => (
            <li key={card.id} className="rounded-md border border-border p-3 text-sm">
              {editing === card.id ? (
                <div className="space-y-2">
                  <label className="block text-xs font-medium">
                    Front
                    <textarea className={`${inputClass} mt-1`} rows={2} value={card.front} onChange={(e) => edit(card.id, { front: e.target.value })} autoFocus />
                  </label>
                  <label className="block text-xs font-medium">
                    Back
                    <textarea className={`${inputClass} mt-1`} rows={3} value={card.back} onChange={(e) => edit(card.id, { back: e.target.value })} />
                  </label>
                </div>
              ) : (
                <>
                  <p className="font-medium">{card.front}</p>
                  <p className="mt-1 text-muted">{card.back}</p>
                </>
              )}
              <div className="mt-2 flex gap-1">
                <Button variant="secondary" onClick={() => setEditing(editing === card.id ? null : card.id)}>
                  {editing === card.id ? "Done" : "Edit"}
                </Button>
                <Button variant="danger" className="ml-auto" onClick={() => setCards((cards) => cards.filter((c) => c.id !== card.id))}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

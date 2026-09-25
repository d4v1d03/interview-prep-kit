"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { editQuestion, moveWithinCategory, nextId } from "@/kit/edit";
import { QUESTION_CATEGORIES, type Kit, type Question, type QuestionCategory, type Requirement } from "@/kit/schema";
import { Badge, inputClass, Section } from "./ui";

// Pick, not Omit: Omit on a type with an index signature drops the named fields.
type NewQuestion = Pick<Question, "category" | "prompt" | "answer_outline" | "difficulty" | "requirement_ids" | "origin">;

export const CATEGORY_LABEL: Record<QuestionCategory, string> = {
  technical: "Technical",
  "system-design": "System design",
  behavioural: "Behavioural",
  "company-fit": "Company fit",
};

type Props = {
  kit: Kit;
  update: (change: (kit: Kit) => Kit) => void;
  onRegenerate: (category: QuestionCategory) => void;
};

export function QuestionsSection({ kit, update, onRegenerate }: Props) {
  const [lastDeleted, setLastDeleted] = useState<{ question: Question; index: number } | null>(null);

  const setQuestions = (change: (qs: Question[]) => Question[]) => update((k) => ({ ...k, questions: change(k.questions) }));
  const remove = (id: string) => {
    const index = kit.questions.findIndex((q) => q.id === id);
    setLastDeleted({ question: kit.questions[index], index });
    setQuestions((qs) => qs.filter((q) => q.id !== id));
  };
  const undo = () => {
    if (!lastDeleted) return;
    setQuestions((qs) => [...qs.slice(0, lastDeleted.index), lastDeleted.question, ...qs.slice(lastDeleted.index)]);
    setLastDeleted(null);
  };

  return (
    <Section id="questions" title={`Questions (${kit.questions.length})`}>
      <p className="text-sm text-muted">
        Edited, pinned and your own questions are kept when a category is regenerated; only untouched generated ones are replaced.
      </p>
      {lastDeleted && (
        <div role="status" className="mt-3 flex items-center gap-3 rounded-md bg-background px-3 py-2 text-sm">
          Question deleted.
          <Button variant="secondary" onClick={undo}>
            Undo
          </Button>
        </div>
      )}
      <div className="mt-4 space-y-6">
        {QUESTION_CATEGORIES.map((category) => {
          const questions = kit.questions.filter((q) => q.category === category);
          return (
            <div key={category} aria-labelledby={`cat-${category}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-1">
                <h3 id={`cat-${category}`} className="font-medium">
                  {CATEGORY_LABEL[category]} <span className="text-muted">({questions.length})</span>
                </h3>
                <Button variant="ghost" onClick={() => onRegenerate(category)}>
                  ↻ Regenerate {CATEGORY_LABEL[category].toLowerCase()}
                </Button>
              </div>
              {questions.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No questions in this category.</p>
              ) : (
                <ol className="mt-2 space-y-2">
                  {questions.map((q, i) => (
                    <QuestionCard
                      key={q.id}
                      question={q}
                      requirements={kit.role.requirements}
                      isFirst={i === 0}
                      isLast={i === questions.length - 1}
                      onChange={(patch) => setQuestions((qs) => qs.map((x) => (x.id === q.id ? editQuestion(x, patch) : x)))}
                      onMove={(dir) => setQuestions((qs) => moveWithinCategory(qs, q.id, dir))}
                      onDelete={() => remove(q.id)}
                    />
                  ))}
                </ol>
              )}
              <AddQuestion
                category={category}
                requirements={kit.role.requirements}
                onAdd={(q) => setQuestions((qs) => [...qs, { ...q, id: nextId(qs, "q") }])}
              />
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function QuestionCard({
  question: q,
  requirements,
  isFirst,
  isLast,
  onChange,
  onMove,
  onDelete,
}: {
  question: Question;
  requirements: Requirement[];
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<Question>) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const reqText = (id: string) => requirements.find((r) => r.id === id)?.text ?? id;

  return (
    <li id={q.id} className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-mono text-muted">{q.id}</span>
        <Badge tone={q.difficulty === 3 ? "danger" : q.difficulty === 2 ? "warning" : "success"}>
          {["", "Warm-up", "Typical", "Hard"][q.difficulty]}
        </Badge>
        <OriginBadge q={q} />
        {q.requirement_ids.map((id) => (
          <Badge key={id} tone="accent" title={reqText(id)}>
            {id}
          </Badge>
        ))}
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <label className="block text-xs font-medium">
            Question
            <textarea className={`${inputClass} mt-1`} rows={3} value={q.prompt} onChange={(e) => onChange({ prompt: e.target.value })} />
          </label>
          <label className="block text-xs font-medium">
            Answer outline
            <textarea className={`${inputClass} mt-1`} rows={4} value={q.answer_outline} onChange={(e) => onChange({ answer_outline: e.target.value })} />
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="text-xs font-medium">
              Difficulty
              <select className={`${inputClass} mt-1`} value={q.difficulty} onChange={(e) => onChange({ difficulty: Number(e.target.value) })}>
                <option value={1}>1 · Warm-up</option>
                <option value={2}>2 · Typical</option>
                <option value={3}>3 · Hard</option>
              </select>
            </label>
            <fieldset className="text-xs">
              <legend className="font-medium">Tests requirements</legend>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {requirements.map((r) => (
                  <label key={r.id} className="flex items-center gap-1" title={r.text}>
                    <input
                      type="checkbox"
                      checked={q.requirement_ids.includes(r.id)}
                      onChange={(e) =>
                        onChange({
                          requirement_ids: e.target.checked ? [...q.requirement_ids, r.id] : q.requirement_ids.filter((id) => id !== r.id),
                        })
                      }
                    />
                    {r.id}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm">{q.prompt}</p>
          {q.answer_outline && (
            <details className="mt-1 text-sm">
              <summary className="cursor-pointer text-muted">Answer outline</summary>
              <p className="mt-1 whitespace-pre-line text-muted">{q.answer_outline}</p>
            </details>
          )}
        </>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <Button variant="secondary" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
          {editing ? "Done" : "Edit"}
        </Button>
        <Button variant="ghost" onClick={() => onChange({ pinned: !q.pinned })} aria-pressed={!!q.pinned}>
          {q.pinned ? "📌 Pinned" : "Pin"}
        </Button>
        <Button variant="ghost" onClick={() => onMove(-1)} disabled={isFirst} aria-label={`Move ${q.id} up`}>
          ↑
        </Button>
        <Button variant="ghost" onClick={() => onMove(1)} disabled={isLast} aria-label={`Move ${q.id} down`}>
          ↓
        </Button>
        <label className="sr-only" htmlFor={`${q.id}-category`}>
          Move {q.id} to category
        </label>
        <select
          id={`${q.id}-category`}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          value={q.category}
          onChange={(e) => onChange({ category: e.target.value as QuestionCategory })}
        >
          {QUESTION_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <Button variant="danger" onClick={onDelete} className="ml-auto">
          Delete
        </Button>
      </div>
    </li>
  );
}

function OriginBadge({ q }: { q: Question }) {
  if (q.origin === "user") return <Badge tone="accent">Yours</Badge>;
  if (q.edited) return <Badge tone="accent">Edited</Badge>;
  if (q.origin === "gap-pass") return <Badge title="Added by the coverage check">Gap pass</Badge>;
  if (q.origin === "template") return <Badge title="Written by code when the model left a gap">Template</Badge>;
  return <Badge>Generated</Badge>;
}

function AddQuestion({
  category,
  requirements,
  onAdd,
}: {
  category: QuestionCategory;
  requirements: Requirement[];
  onAdd: (q: NewQuestion) => void;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [outline, setOutline] = useState("");
  const [requirement, setRequirement] = useState("");

  if (!open) {
    return (
      <Button variant="ghost" className="mt-2" onClick={() => setOpen(true)}>
        + Add a {CATEGORY_LABEL[category].toLowerCase()} question
      </Button>
    );
  }
  return (
    <form
      className="mt-2 space-y-2 rounded-md border border-dashed border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!prompt.trim()) return;
        onAdd({ category, prompt: prompt.trim(), answer_outline: outline.trim(), difficulty: 2, requirement_ids: requirement ? [requirement] : [], origin: "user" });
        setPrompt("");
        setOutline("");
        setOpen(false);
      }}
    >
      <label className="block text-xs font-medium">
        Question
        <textarea className={`${inputClass} mt-1`} rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} autoFocus required />
      </label>
      <label className="block text-xs font-medium">
        Answer outline (optional)
        <textarea className={`${inputClass} mt-1`} rows={2} value={outline} onChange={(e) => setOutline(e.target.value)} />
      </label>
      <label className="block text-xs font-medium">
        Tests requirement
        <select className={`${inputClass} mt-1`} value={requirement} onChange={(e) => setRequirement(e.target.value)}>
          <option value="">None</option>
          {requirements.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id} · {r.text}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <Button type="submit">Add question</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

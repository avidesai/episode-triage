import { useEffect, useRef, useState } from "preact/hooks";
import { localLine, setNote, setStatus, statusOf, storageOK, workflow, type Status } from "../state";
import { Kbd } from "./Kbd";
import { toast } from "./Toast";

const WORD: Record<Status, string> = { new: "Set back to new", ack: "Acknowledged", resolved: "Resolved" };

/** Change an incident's status with a toast that can undo it. Pressing the current status
 *  again sets it back to New. */
export function changeStatus(id: string, s: Status): void {
  const prev = statusOf(id);
  const next = prev === s ? "new" : s;
  setStatus(id, next);
  toast(`${WORD[next]} ${id}`, storageOK ? "saved in this browser" : "not saved, this browser blocks site storage", () => setStatus(id, prev));
}

/** Status segmented control and the note, with the "saved in this browser only" line. */
export function StatusControl({ id, card = true }: { id: string; card?: boolean }) {
  const st = statusOf(id, workflow.value);
  const saved = workflow.value[id]?.note ?? "";
  const [note, setLocal] = useState(saved);
  const timer = useRef(0);
  useEffect(() => setLocal(workflow.value[id]?.note ?? ""), [id]);

  const onInput = (v: string) => {
    const t = v.slice(0, 280);
    setLocal(t);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNote(id, t), 400);
  };

  const body = (
    <div class="status">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <span class="lbl">Status</span>
        <span class="local">{localLine()}</span>
      </div>
      <div class="seg" role="group" aria-label="Status" style="align-self:flex-start">
        <button type="button" aria-pressed={st === "new" ? "true" : "false"} onClick={() => st !== "new" && changeStatus(id, st)}>
          New
        </button>
        <button type="button" aria-pressed={st === "ack" ? "true" : "false"} onClick={() => changeStatus(id, "ack")}>
          Acknowledged <Kbd>A</Kbd>
        </button>
        <button type="button" aria-pressed={st === "resolved" ? "true" : "false"} onClick={() => changeStatus(id, "resolved")}>
          Resolved <Kbd>R</Kbd>
        </button>
      </div>
      <label class="lbl" for={`note-${id}`} style="margin-top:2px">
        Note
      </label>
      <textarea
        id={`note-${id}`}
        class="textarea"
        rows={2}
        maxLength={280}
        value={note}
        placeholder="What you checked, who has it"
        onInput={(e) => onInput((e.target as HTMLTextAreaElement).value)}
        onBlur={() => {
          clearTimeout(timer.current);
          setNote(id, note);
        }}
      />
    </div>
  );
  return card ? <section class="card card-pad" aria-label="Status">{body}</section> : body;
}

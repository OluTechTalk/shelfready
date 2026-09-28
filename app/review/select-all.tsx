"use client";

// Ticks or clears every product checkbox that belongs to the bulk form.
export function SelectAll({ form }: { form: string }) {
  const set = (checked: boolean) => {
    for (const box of document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${form}"]`)) box.checked = checked;
  };
  return (
    <span className="flex gap-2 text-sm">
      <button type="button" onClick={() => set(true)} className="underline underline-offset-2">
        Select all
      </button>
      <button type="button" onClick={() => set(false)} className="underline underline-offset-2">
        Clear
      </button>
    </span>
  );
}

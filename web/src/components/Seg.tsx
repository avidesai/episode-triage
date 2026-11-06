import type { ComponentChildren } from "preact";

export interface SegOption<T extends string> {
  value: T;
  label: ComponentChildren;
  title?: string;
}

/** Segmented control: buttons with aria-pressed. */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  label,
  style,
}: {
  options: SegOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  label: string;
  style?: Record<string, string>;
}) {
  return (
    <div class="seg" role="group" aria-label={label} style={style}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value ? "true" : "false"} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

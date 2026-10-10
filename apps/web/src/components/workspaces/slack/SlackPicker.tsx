import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";

export interface SlackPickerItem {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

/** One choice out of a few, as a settings control; a value the items do not name shows nothing. */
export function SlackPicker({
  label,
  value,
  items,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly items: ReadonlyArray<SlackPickerItem>;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <Select
      items={items}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null && next !== value) onChange(next);
      }}
    >
      <SelectTrigger size="sm" className="w-48" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value} disabled={item.disabled === true}>
            {item.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

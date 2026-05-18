import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

interface DatePickerProps {
  readonly id?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly className?: string;
}

function parseDate(str: string): Date | undefined {
  if (!str) return undefined;
  const d = new Date(str + "T00:00:00");
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function DatePicker({ id, value, onChange, className }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = parseDate(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:focus:ring-blue-400/40 transition-colors w-full ${className ?? ""}`}
      >
        <CalendarIcon size={14} className="text-gray-400 shrink-0" />
        <span className={value ? "" : "text-gray-400 dark:text-gray-500"}>
          {value || "選擇日期"}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            if (d) onChange(formatDate(d));
            setOpen(false);
          }}
          defaultMonth={selected}
        />
      </PopoverContent>
    </Popover>
  );
}

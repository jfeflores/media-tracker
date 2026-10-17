"use client";

import { Bell, CalendarDays, ChevronRight, Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import { TYPE_LABELS, type MediaItem } from "@/app/lib/media";

type ReminderItem = Pick<MediaItem, "id" | "title" | "type" | "reminderDate">;

type ReminderCenterProps = {
  items: ReminderItem[];
  open: boolean;
  onOpenChange(open: boolean): void;
  onOpenItem(id: string): void;
  onAdd(): void;
};

export default function ReminderCenter({ items, open, onOpenChange, onOpenItem, onAdd }: ReminderCenterProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onOpenChange, open]);

  const visibleItems = items.slice(0, 8);
  return (
    <div className="reminder-center" ref={rootRef}>
      <button
        className="reminder-button"
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-label={`${items.length} ${items.length === 1 ? "reminder" : "reminders"}`}
        aria-expanded={open}
        aria-controls="reminder-center-panel"
      >
        <Bell size={18} />
        {items.length > 0 && <span>{items.length}</span>}
      </button>

      {open && (
        <section id="reminder-center-panel" className="reminder-center__panel" role="dialog" aria-label="Reminders">
          <header>
            <div><span>Upcoming</span><h2>Reminders</h2></div>
            <strong>{items.length}</strong>
          </header>
          {visibleItems.length ? (
            <div className="reminder-center__list">
              {visibleItems.map((item) => (
                <button key={item.id} type="button" onClick={() => { onOpenItem(item.id); onOpenChange(false); }}>
                  <span className="reminder-center__date"><CalendarDays size={14} />{relativeReminder(item.reminderDate!)}</span>
                  <span className="reminder-center__title"><strong>{item.title}</strong><small>{TYPE_LABELS[item.type]} · {formatReminderDate(item.reminderDate!)}</small></span>
                  <ChevronRight size={15} />
                </button>
              ))}
              {items.length > visibleItems.length && <p>Showing the next {visibleItems.length} reminders.</p>}
            </div>
          ) : (
            <div className="reminder-center__empty">
              <Bell size={20} />
              <strong>No reminders yet</strong>
              <p>Add one from any title’s edit screen.</p>
            </div>
          )}
          <footer><button type="button" onClick={() => { onAdd(); onOpenChange(false); }}><Plus size={14} /> Add media with a reminder</button></footer>
        </section>
      )}
    </div>
  );
}

function relativeReminder(value: string) {
  const target = new Date(`${value.slice(0, 10)}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

function formatReminderDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

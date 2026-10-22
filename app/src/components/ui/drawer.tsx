"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/** Right-hand slide-in editor. Focus is trapped and returns to the trigger on close. */
export function Drawer({ open, onOpenChange, title, description, footer, children }: DrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-text/30" />
        <Dialog.Content
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-bg shadow-drawer md:w-[var(--drawer-width)]",
            "focus:outline-none",
          )}
          {...(!description && { "aria-describedby": undefined })}
        >
          <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
              {description && <Dialog.Description className="text-sm text-text-muted">{description}</Dialog.Description>}
            </div>
            <Dialog.Close className="rounded-sm p-1 text-text-muted hover:bg-row-hover" aria-label="Close">
              <X className="size-5" />
            </Dialog.Close>
          </header>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

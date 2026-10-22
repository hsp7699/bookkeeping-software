import { Slot } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "bg-bg text-text border border-border-input hover:bg-row-hover",
  ghost: "bg-transparent text-text hover:bg-row-hover",
  danger: "bg-danger text-on-accent hover:brightness-95",
  link: "bg-transparent text-accent underline-offset-2 hover:underline px-0 h-auto",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-sm gap-1.5",
  md: "h-9 px-3.5 text-base gap-2",
  lg: "h-11 px-5 text-md gap-2",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, asChild, className, children, disabled, type = "button", ...rest },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-semibold whitespace-nowrap select-none",
        "transition-colors duration-[var(--motion-fast)] disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        variant !== "link" && sizes[size],
        className,
      )}
      {...rest}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {children}
        </>
      )}
    </Comp>
  );
});

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const button = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-navy text-white hover:bg-[#13305a]",
        ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
        outline: "border border-border bg-surface text-ink hover:bg-surface-2",
        danger: "border border-border bg-surface text-neg hover:bg-[#FEF3F2]",
      },
      size: { sm: "h-7 px-2.5 text-[12px]", md: "h-8 px-3 text-[14px]", icon: "h-8 w-8" },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button> & { asChild?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant, size, asChild, ...props }, ref) {
  const Component = asChild ? Slot : "button";
  return <Component ref={ref} className={cn(button({ variant, size }), className)} {...props} />;
});

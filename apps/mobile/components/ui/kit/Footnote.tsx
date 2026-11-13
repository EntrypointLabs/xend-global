import React from "react";
import { Typography } from "@/components/ui/atoms/Typography";
import { cn } from "@/utils/cn";

export function Footnote({
  children,
  className,
  tone = "muted",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "muted" | "error";
}) {
  return (
    <Typography
      weight={tone === "error" ? "500" : "400"}
      accessibilityRole={tone === "error" ? "alert" : undefined}
      className={cn(
        tone === "error"
          ? "text-[13px] leading-5 text-destructive"
          : "text-[12px] leading-[18px] text-black/40",
        className
      )}
    >
      {children}
    </Typography>
  );
}

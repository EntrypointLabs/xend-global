import React from "react";
import { TextProps } from "react-native";
import { Typography, TypographyProps } from "./Typography";
import { cn } from "@/utils/cn";

export type ThemedTextProps = TextProps & {
  type?:
    | "default"
    | "highlight"
    | "defaultSemiBold"
    | "subtitle"
    | "link"
    | "jumbo"
    | "regular"
    | "regularSemiBold"
    | "tiny"
    | "large"
    | "small";
  className?: string;
};

const typeToWeight: Record<string, TypographyProps["weight"]> = {
  tiny: "500",
  regular: "500",
  regularSemiBold: "600",
  default: "400",
  defaultSemiBold: "600",
  highlight: "700",
  large: "600",
  jumbo: "700",
  subtitle: "600",
  link: "400",
  small: "400",
};

const typeToClass: Record<string, string> = {
  tiny: "text-[12px] leading-[12px]",
  regular: "text-[14px] leading-[18px]",
  regularSemiBold: "text-[14px] leading-[17px]",
  default: "text-[16px] leading-[19px]",
  defaultSemiBold: "text-[16px] leading-[21px]",
  highlight: "text-[56px] leading-[67px]",
  large: "text-[24px] leading-[29px]",
  jumbo: "text-[40px] leading-[48px]",
  subtitle: "text-[20px]",
  link: "text-[16px] leading-[30px] text-white",
  small: "text-[13px] leading-[16px]",
};

export function ThemedText({
  children,
  type = "default",
  className,
  ...props
}: ThemedTextProps) {
  return (
    <Typography
      weight={typeToWeight[type]}
      className={cn("text-foreground", typeToClass[type], className)}
      {...props}
    >
      {children}
    </Typography>
  );
}

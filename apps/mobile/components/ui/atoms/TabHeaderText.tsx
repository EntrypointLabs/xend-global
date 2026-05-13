import React from "react";
import { TextProps } from "react-native";
import { Typography } from "./Typography";
import { cn } from "@/utils/cn";

const TabHeaderText = ({ children, className, ...props }: TextProps) => {
  return (
    <Typography
      weight="600"
      className={cn("pb-8 text-lg text-black", className)}
      {...props}
    >
      {children}
    </Typography>
  );
};

export default TabHeaderText;

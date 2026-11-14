import React from "react";
import { TextProps } from "react-native";
import { Typography } from "./Typography";
import { cn } from "@/utils/cn";
import { useOnPhoto } from "@/components/ui/glass";

const TabHeaderText = ({ children, className, ...props }: TextProps) => {
  const onPhoto = useOnPhoto();
  return (
    <Typography
      weight="600"
      className={cn(
        "pb-8 text-lg",
        onPhoto ? "text-white" : "text-black",
        className
      )}
      {...props}
    >
      {children}
    </Typography>
  );
};

export default TabHeaderText;

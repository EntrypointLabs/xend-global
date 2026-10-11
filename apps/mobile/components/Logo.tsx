import React from "react";
import { Image } from "react-native";

const Logo = () => {
  return (
    <Image
      source={require("@/assets/images/logo/prydd.png")}
      className="h-12 w-12"
      resizeMode="contain"
    />
  );
};

export default Logo;

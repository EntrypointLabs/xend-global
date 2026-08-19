import React, { useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";

import { Typography } from "@/components/ui/atoms/Typography";
import { localIconForMint } from "@/utils/tokens";

interface TokenMarkProps {
  mint: string;
  /** Fallback lettering when no logo can be resolved. */
  label: string;
  /** Logo URL from the token index, when it has one. */
  iconUrl?: string | null;
  size?: number;
}

/**
 * The circular badge that identifies a token.
 *
 * Three sources, in order: a logo bundled with the app, the URL the token
 * index gave us, then the token's own initials. The bundled asset comes first
 * because the index covers mainnet only, so on a test network the mint a
 * Consumer actually holds is exactly the one it cannot name.
 */
export function TokenMark({ mint, label, iconUrl, size = 48 }: TokenMarkProps) {
  const [remoteFailed, setRemoteFailed] = useState(false);
  const local = localIconForMint(mint);
  const showRemote = !local && iconUrl && !remoteFailed;

  return (
    <View
      className="items-center justify-center overflow-hidden rounded-full bg-black/5"
      style={{ width: size, height: size }}
    >
      {local ? (
        <Image
          source={local}
          style={{ width: size, height: size }}
          contentFit="cover"
        />
      ) : showRemote ? (
        <Image
          source={{ uri: iconUrl }}
          style={{ width: size, height: size }}
          contentFit="cover"
          // A logo that will not load must not leave a blank disc where the
          // token's identity should be.
          onError={() => setRemoteFailed(true)}
          transition={150}
        />
      ) : (
        <Typography weight="600" style={{ fontSize: size * 0.3 }}>
          {label.slice(0, 2).toUpperCase()}
        </Typography>
      )}
    </View>
  );
}

import React from 'react'
import { Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native'
import * as Haptics from 'expo-haptics'

interface HapticPressableProps extends PressableProps {
    style?: StyleProp<ViewStyle>;
}

const HapticPressable = ({ style, ...props }: HapticPressableProps) => {
    return (
        <Pressable
            {...props}
            style={style}
            onPress={(event) => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                props.onPress?.(event);
            }}
            onLongPress={(event) => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                props.onLongPress?.(event);
            }}>
            {props.children}
        </Pressable>
    )
}

export default HapticPressable
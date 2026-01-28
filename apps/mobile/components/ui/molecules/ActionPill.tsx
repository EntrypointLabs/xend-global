import React from 'react';
import { View } from 'react-native';
import HapticPressable from '@/components/ui/atoms/HapticPressable';

export interface ActionPillItem {
    icon: React.FC<{ isActive?: boolean }>;
    label?: string;
    onPress: () => void;
    onLongPress?: () => void;
    isActive?: boolean;
    accessibilityLabel?: string;
    testID?: string;
}

export interface ActionPillProps {
    items: ActionPillItem[];
    containerStyle?: any;
}

export function ActionPill({ items, containerStyle }: ActionPillProps) {
    const shadowStyle = {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 2,
    };

    return (
        <View
            className='flex-row py-3 px-5 rounded-full items-center gap-7 bg-white'
            style={[shadowStyle, containerStyle]}
        >
            {items.map((item, index) => {
                const Icon = item.icon;
                return (
                    <HapticPressable
                        key={index}
                        accessibilityRole="button"
                        accessibilityState={item.isActive ? { selected: true } : {}}
                        accessibilityLabel={item.accessibilityLabel}
                        testID={item.testID}
                        onPress={item.onPress}
                        onLongPress={item.onLongPress}
                        className="items-center justify-center"
                    >
                        <Icon isActive={item.isActive} />
                    </HapticPressable>
                );
            })}
        </View>
    );
}

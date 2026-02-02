import { View, ImageSourcePropType, Image, TouchableOpacity } from 'react-native';
import { Typography } from '../atoms/Typography';

export interface ActivityItemProps {
    title: string;
    subtitle: string;
    value: string;
    isPositive?: boolean;
    isHidden?: boolean;
    icon: ImageSourcePropType;
    onPress?: () => void;
    // Extra data for modal
    date?: string;
    status?: string;
    [key: string]: any;
}

export function ActivityItem({ title, subtitle, value, isPositive, isHidden, icon, onPress }: ActivityItemProps) {

    const positiveColor = '#34C759'; // Green
    const negativeColor = '#FF3B30'; // Red

    const displayValue = isHidden ? '****' : value;
    const valueColor = isHidden ? undefined : (isPositive ? positiveColor : negativeColor);

    return (
        <TouchableOpacity className="flex-row items-center py-4" onPress={onPress} activeOpacity={0.7}>
            <Image source={icon} className="w-10 h-10 rounded-full mr-4" />
            <View className="flex-1 flex-row justify-between items-center">
                <View className="flex-col">
                    <Typography weight="600" className="mb-0.5">{title}</Typography>
                    <Typography weight="500" className="text-[13px] text-black/30">{subtitle}</Typography>
                </View>
                <Typography
                    weight="600"
                    className="text-[13px] tracking-[0.5px]"
                    style={{ color: valueColor }}
                >
                    {displayValue}
                </Typography>
            </View>
        </TouchableOpacity>
    );
}



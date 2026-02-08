import { View } from 'react-native'
import React from 'react'
import { Typography, TypographyProps } from './ui/atoms/Typography'
import { cn } from '@/utils/class'

type BalanceViewProps = TypographyProps & {
    amount: string
}

const BalanceView = ({ amount, ...props }: BalanceViewProps) => {
    const [integerPart, decimalPart] = amount.split('.')
    return (
        <View className="flex-row items-baseline">
            <Typography {...props}>${integerPart}.</Typography>
            <Typography {...props} className={cn(props.className, "text-black/30")}>{decimalPart || '00'}</Typography>
        </View>
    )
}

export default BalanceView


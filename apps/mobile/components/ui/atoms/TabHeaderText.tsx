import React from 'react'
import { TextProps } from 'react-native'
import { Typography } from './Typography'
import { cn } from '@/utils/class'

const TabHeaderText = ({ children, className, ...props }: TextProps) => {
    return (
        <Typography weight="600" className={cn("text-black text-lg", className)} {...props}>{children}</Typography>
    )
}

export default TabHeaderText
import React from 'react'
import { Text, TextProps } from 'react-native'
import clsx from 'clsx'

const TabHeaderText = ({ children, className, ...props }: TextProps) => {
    return (
        <Text className={clsx("text-black font-medium text-lg", className)} {...props}>{children}</Text>
    )
}

export default TabHeaderText
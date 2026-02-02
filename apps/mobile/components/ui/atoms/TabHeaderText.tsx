import React from 'react'
import { TextProps } from 'react-native'
import clsx from 'clsx'
import { Typography } from './Typography'

const TabHeaderText = ({ children, className, ...props }: TextProps) => {
    return (
        <Typography weight="500" className={clsx("text-black text-lg", className)} {...props}>{children}</Typography>
    )
}

export default TabHeaderText
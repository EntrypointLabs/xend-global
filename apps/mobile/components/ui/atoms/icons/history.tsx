import React from 'react'
import Svg, { Path, Rect } from 'react-native-svg'

const History = ({ isActive, className }: { isActive?: boolean, className?: string }) => {
    return (
        <Svg width="29" height="29" viewBox="0 0 29 29" fill="none" className={className}>
            <Rect width="28.281" height="28.281" rx="14.1405" transform="matrix(-1 0 0 1 28.281 0)" fill="black" fillOpacity={isActive ? "1" : "0.3"} />
            <Path d="M14.7176 5.88708C14.1758 5.88722 13.7371 6.32672 13.7371 6.86853V14.7181H5.88752C5.34571 14.7181 4.90621 15.1568 4.90607 15.6986C4.90607 16.2405 5.34562 16.6801 5.88752 16.6801H14.7176C14.7855 16.6801 14.8518 16.6737 14.9158 16.6605C15.3628 16.5688 15.699 16.1726 15.699 15.6986V6.86853C15.699 6.32663 15.2595 5.88708 14.7176 5.88708Z" fill="white" />
        </Svg>

    )
}

export default History
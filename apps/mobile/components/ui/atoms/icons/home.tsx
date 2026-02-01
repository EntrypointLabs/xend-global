import React from 'react'
import Svg, { Path } from 'react-native-svg'

const Home = ({ isActive, className }: { isActive?: boolean, className?: string }) => {
    return (
        <Svg width="29" height="29" viewBox="0 0 29 29" fill="none" className={className}>
            <Path d="M9.60547 1.29773C11.7386 -0.356899 15.1435 -0.441498 17.3613 1.11414L25.498 6.81335C27.052 7.9023 28.2812 10.2499 28.2812 12.1591V21.7469C28.2812 25.3531 25.3571 28.281 21.7549 28.2811H6.52637C2.92415 28.2811 6.26027e-05 25.3395 0 21.7333V11.9755C0 10.1936 1.11567 7.93011 2.52832 6.82703L9.60547 1.29773Z" fill="black" fillOpacity={isActive ? "1" : "0.3"} />
        </Svg>

    )
}

export default Home
import React from 'react'
import { Image } from 'react-native'

const Logo = () => {
    return (
        <Image source={require('@/assets/images/logo/fuse.png')} className='w-12 h-12' resizeMode='contain' />
    )
}


export default Logo
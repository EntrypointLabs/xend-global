import React from 'react'
import { ActivityIndicator, View } from 'react-native'

function LoadingScreen() {
  return (
    <View className='flex-1 items-center justify-center'>
      <ActivityIndicator size="large" />
    </View>
  );
}

export default LoadingScreen;
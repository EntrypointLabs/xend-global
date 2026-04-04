import LoadingScreen from '@/components/ui/layout/LoadingScreen'
import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react'
import { View } from 'react-native'

function PasskeyCallbackScreen() {
    const searchParams = useLocalSearchParams();

    const { status } = searchParams;

    console.log('status', {status, searchParams});
    console.log('url');

    // if (status === 'success') {
    //     return <Redirect href="/(tabs)" withAnchor />
    // }

    return <LoadingScreen />;
}

export default PasskeyCallbackScreen;
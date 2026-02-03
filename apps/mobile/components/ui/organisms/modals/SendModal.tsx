import React from 'react';
import { ActionModal } from '../ActionModal';
import { ModalOptionsList } from '../../molecules/ModalOptionsList';
import { ActionOption } from '../../molecules/ModalOptionsList';
import { router } from 'expo-router';
import { useKyc } from '@/hooks/useKyc';
import { useModalFlow } from '@/contexts/ModalFlowContext';
import { Image, View } from 'react-native';
import { Typography } from '@/components/ui/atoms/Typography';

const bankIcon = require('@/assets/icons/bank.png');
const walletIcon = require('@/assets/icons/wallet.png');

interface SendModalProps {
    visible: boolean;
    onClose: () => void;
    onSendToWallet: () => void;
}

export function SendModal({ visible, onClose, onSendToWallet }: SendModalProps) {
    const { isBankDisabled, status, tosStatus } = useKyc();
    const { hideAllModals } = useModalFlow();


    const handleSendToWallet = () => {
        onClose();
        onSendToWallet();
    };

    const handleSendToBank = () => {
        onClose();

        if (status === 'not_started' || status === 'incomplete' || tosStatus === 'pending') {
            hideAllModals();
            router.push({ pathname: '/kyc', params: { source: 'send' } });
            return;
        }

        router.push({
            pathname: '/(send)/fiatamount',
            params: {
                type: 'bank',
                title: 'Send Fiat'
            }
        });
    };

    const sendOptions: ActionOption[] = [
        {
            key: 'fiat',
            title: 'To bank account',
            description: 'Send USDC/EURC to bank Account',
            icon: bankIcon,
            onPress: handleSendToBank,
            disabled: isBankDisabled
        },
        {
            key: 'crypto',
            title: 'To crypto wallet',
            description: 'Send assets to a solana address',
            icon: walletIcon,
            onPress: handleSendToWallet,
        },
    ];

    return (
        <ActionModal
            visible={visible}
            onClose={onClose}
        >
            <View className='flex-col items-center justify-center mb-5'>
                <Image source={require('@/assets/icons/send.png')} className='h-8 w-8 mb-5' resizeMode='contain' />
                <Typography weight="600" className='text-base mb-1'>Send</Typography>
                <Typography weight="500" className='text-sm text-black/40 max-w-[192px] text-center'>Choose one of the options below to send crypto assets</Typography>
            </View>
            <ModalOptionsList options={sendOptions} />
        </ActionModal>
    );
} 
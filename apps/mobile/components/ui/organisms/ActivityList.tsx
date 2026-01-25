import React, { useCallback, useState } from 'react';
import { StyleSheet, SectionList, RefreshControl } from 'react-native';
import { ThemedText } from '@/components/ui/atoms';
import { ActivityItem, ActivityItemProps } from './ActivityItem';
import { Spacing } from '@/constants/Spacing';
import { useThemeColor } from '@/hooks/useThemeColor';

export interface ActivitySection {
    title: string;
    data: ActivityItemProps[];
}

interface ActivityListProps {
    sections: ActivitySection[];
}

export function ActivityList({ sections }: ActivityListProps) {
    const sectionHeaderColor = useThemeColor({}, 'tabIconDefault');
    const [refreshing, setRefreshing] = useState(false);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        // TODO: Add refresh logic
        setTimeout(() => {
            setRefreshing(false);
        }, 1000);
    }, []);

    return (
        <SectionList
            sections={sections}
            keyExtractor={(item, index) => item.title + index}
            renderItem={({ item }) => (
                <ActivityItem {...item} />
            )}
            renderSectionHeader={({ section: { title } }) => (
                <ThemedText style={[styles.header, { color: sectionHeaderColor }]}>{title}</ThemedText>
            )}
            contentContainerStyle={styles.contentContainer}
            stickySectionHeadersEnabled={false}
            showsVerticalScrollIndicator={false}
            refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
        />
    );
}

const styles = StyleSheet.create({
    contentContainer: {
        paddingBottom: Spacing.xl,
    },
    header: {
        fontSize: 13,
        marginTop: Spacing.lg,
        marginBottom: Spacing.xs,
    },
});

import React from 'react';
import { StyleSheet, View, SectionList } from 'react-native';
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

import React from 'react';
import type { WorkspaceState, Space, TabGroup } from '../types';

interface SpacesOverviewProps {
  workspace: WorkspaceState;
  onNavigateToTabGroup: (spaceId: string, tabGroupId: string) => void;
}

export function SpacesOverview({ workspace, onNavigateToTabGroup }: SpacesOverviewProps) {
  const spacesWithTabGroups = workspace.spaces
    .filter((space) => !space.isSystem) // Don't show Home in overview
    .map((space) => ({
      space,
      tabGroups: workspace.tabGroups
        .filter((tg) => space.tabGroupIds.includes(tg.id))
        .sort((a, b) => a.order - b.order),
    }));

  return (
    <div className="h-full w-full overflow-auto bg-zinc-900 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">Spaces</h1>

        {spacesWithTabGroups.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-zinc-400 text-lg mb-4">No spaces yet</p>
            <p className="text-zinc-500">Create a space to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {spacesWithTabGroups.map(({ space, tabGroups }) => (
              <div
                key={space.id}
                className="bg-zinc-800 rounded-lg border border-zinc-700 overflow-hidden hover:border-zinc-600 transition-colors"
              >
                <div className="p-4 border-b border-zinc-700">
                  <h2 className="text-xl font-semibold text-white">{space.name}</h2>
                  <p className="text-sm text-zinc-400 mt-1">
                    {tabGroups.length} tab group{tabGroups.length !== 1 ? 's' : ''}
                  </p>
                </div>

                <div className="p-4">
                  {tabGroups.length === 0 ? (
                    <p className="text-zinc-500 text-sm">No tab groups</p>
                  ) : (
                    <div className="space-y-2">
                      {tabGroups.map((tg) => (
                        <button
                          key={tg.id}
                          onClick={() => onNavigateToTabGroup(space.id, tg.id)}
                          className="w-full text-left px-3 py-2 rounded bg-zinc-700 hover:bg-zinc-600 transition-colors group"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-white font-medium">{tg.label}</span>
                            <svg
                              className="w-4 h-4 text-zinc-400 group-hover:text-white transition-colors"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 5l7 7-7 7"
                              />
                            </svg>
                          </div>
                          <div className="text-xs text-zinc-400 mt-1">
                            {tg.tabs.length} tab{tg.tabs.length !== 1 ? 's' : ''}
                            {tg.pairs.length > 0 && ` • ${tg.pairs.length} pair${tg.pairs.length !== 1 ? 's' : ''}`}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

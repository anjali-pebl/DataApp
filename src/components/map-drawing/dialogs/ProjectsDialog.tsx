'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { FolderOpen, Crosshair, Database, Settings } from 'lucide-react';
import type { Pin, Line as LineType, Area, Project } from '@/lib/supabase/types';
import type { PinFile } from '@/lib/supabase/file-storage-service';

export interface ProjectsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dynamicProjects: Record<string, Project>;
  activeProjectId: string;
  pins: Pin[];
  lines: LineType[];
  areas: Area[];
  projectVisibility: Record<string, boolean>;
  pinFileMetadata: Record<string, PinFile[]>;
  areaFileMetadata: Record<string, PinFile[]>;
  onToggleProjectVisibility: (projectId: string) => void;
  onSetActiveProject: (projectId: string) => void;
  onGoToProjectLocation: (projectId: string) => void;
  onShowProjectData: (projectId: string) => void;
  onShowProjectSettings: (projectId: string) => void;
}

export function ProjectsDialog({
  open,
  onOpenChange,
  dynamicProjects,
  activeProjectId,
  pins,
  lines,
  areas,
  projectVisibility,
  pinFileMetadata,
  areaFileMetadata,
  onToggleProjectVisibility,
  onSetActiveProject,
  onGoToProjectLocation,
  onShowProjectData,
  onShowProjectSettings,
}: ProjectsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            Project Menu
          </DialogTitle>
          <DialogDescription>
            Manage project locations, visibility, and set the active project for drawing operations.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="text-sm text-muted-foreground">
            <p className="mb-2"><strong>Active Project:</strong> {dynamicProjects[activeProjectId]?.name || 'None'}</p>
            <p className="text-xs">All new objects will be assigned to the active project.</p>
          </div>

          <div className="space-y-3">
            {/* Sort projects with active project first */}
            {Object.entries(dynamicProjects)
              .sort(([keyA], [keyB]) => {
                if (keyA === activeProjectId) return -1;
                if (keyB === activeProjectId) return 1;
                return 0;
              })
              .map(([key, location]) => {
                // Get objects for this project
                const projectPins = pins.filter(p => p.projectId === key);
                const projectLines = lines.filter(l => l.projectId === key);
                const projectAreas = areas.filter(a => a.projectId === key);
                const totalObjects = projectPins.length + projectLines.length + projectAreas.length;

                return (
                  <div key={key} className="border rounded-lg">
                    <div className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-3 flex-1">
                        {/* Project Name and Info */}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="font-medium">{location.name}</div>
                            {activeProjectId === key && (
                              <Crosshair className="h-4 w-4 text-accent" />
                            )}
                            {totalObjects > 0 && (
                              <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded">
                                {totalObjects} objects
                              </span>
                            )}
                          </div>
                          {location.lat && location.lon && (
                            <div className="text-xs text-muted-foreground">
                              {location.lat.toFixed(6)}, {location.lon.toFixed(6)}
                            </div>
                          )}
                        </div>

                        {/* Show Objects Dropdown - Only for active project */}
                        {activeProjectId === key && totalObjects > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const element = document.getElementById(`project-objects-${key}`);
                              if (element) {
                                element.style.display = element.style.display === 'none' ? 'block' : 'none';
                              }
                            }}
                            className="h-8 px-2 text-xs"
                          >
                            Show Objects ↓
                          </Button>
                        )}

                        {/* Zoom to Project */}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onGoToProjectLocation(key)}
                          className="h-8 w-8"
                          title="Zoom to project"
                        >
                          <Crosshair className="h-4 w-4 text-accent" />
                        </Button>

                        {/* Activate Button */}
                        <Button
                          variant={activeProjectId === key ? "default" : "outline"}
                          size="sm"
                          onClick={() => onSetActiveProject(key)}
                          disabled={activeProjectId === key}
                          className="h-8 px-2"
                        >
                          {activeProjectId === key ? "Active" : "Activate"}
                        </Button>

                        {/* Visit Button - Only show for active project */}
                        {activeProjectId === key && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onGoToProjectLocation(key)}
                            className="h-8 px-2"
                          >
                            Visit →
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Objects List - Only for active project */}
                    {activeProjectId === key && totalObjects > 0 && (
                      <div id={`project-objects-${key}`} className="border-t bg-muted/30 p-3" style={{display: 'none'}}>
                        <div className="space-y-2 text-sm">
                          {projectPins.length > 0 && (
                            <div>
                              <div className="font-medium text-xs text-muted-foreground mb-1">PINS ({projectPins.length})</div>
                              {projectPins.map(pin => (
                                <div key={pin.id} className="flex items-center gap-2 py-1">
                                  <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                                  <span className="flex-1">{pin.label || 'Unnamed Pin'}</span>

                                  {/* Data indicator for pins with uploaded files */}
                                  {pinFileMetadata[pin.id]?.length > 0 && (
                                    <div className="flex items-center gap-1 ml-auto">
                                      <Database className="h-3 w-3 text-accent" />
                                      <span className="text-xs text-accent font-medium">
                                        {pinFileMetadata[pin.id]?.length || 0}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {projectLines.length > 0 && (
                            <div>
                              <div className="font-medium text-xs text-muted-foreground mb-1">LINES ({projectLines.length})</div>
                              {projectLines.map(line => (
                                <div key={line.id} className="flex items-center gap-2 py-1">
                                  <div className="w-4 h-0.5 bg-green-500"></div>
                                  <span>{line.label || 'Unnamed Line'}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {projectAreas.length > 0 && (
                            <div>
                              <div className="font-medium text-xs text-muted-foreground mb-1">AREAS ({projectAreas.length})</div>
                              {projectAreas.map(area => (
                                <div key={area.id} className="flex items-center gap-2 py-1">
                                  <div className="w-3 h-3 bg-red-500/30 border border-red-500"></div>
                                  <span className="flex-1">{area.label || 'Unnamed Area'}</span>

                                  {/* Data indicator for areas with uploaded files */}
                                  {areaFileMetadata[area.id]?.length > 0 && (
                                    <div className="flex items-center gap-1 ml-auto">
                                      <Database className="h-3 w-3 text-accent" />
                                      <span className="text-xs text-accent font-medium">
                                        {areaFileMetadata[area.id]?.length || 0}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Project Data and Settings Buttons */}
                          <div className="pt-3 border-t border-muted-foreground/20 mt-3">
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs px-2 flex-1"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onShowProjectData(key);
                                }}
                              >
                                <Database className="h-3 w-3 mr-1" />
                                Project Data
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onShowProjectSettings(key);
                                }}
                              >
                                <Settings className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

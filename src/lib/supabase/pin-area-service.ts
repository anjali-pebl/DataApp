import { createClient } from './client';
import { Pin, Area } from './types';

class PinAreaService {
  private supabase = createClient();

  // Note: RLS policies handle access control - users see their own data,
  // PEBL admins see all data, partners see shared project data

  /**
   * Get all pins for a specific project
   */
  async getProjectPins(projectId: string): Promise<Pin[]> {
    const { data: { user } } = await this.supabase.auth.getUser();
    if (!user) {
      console.warn('[PinAreaService] User not authenticated');
      return [];
    }

    // Let RLS handle access control - no user_id filter needed
    const { data, error } = await this.supabase
      .from('pins')
      .select('*')
      .eq('project_id', projectId);

    if (error) {
      console.error('[PinAreaService] Error fetching project pins:', error);
      throw error;
    }

    return (data || []).map(pin => ({
      id: pin.id,
      lat: pin.lat,
      lng: pin.lng,
      label: pin.label,
      notes: pin.notes || undefined,
      labelVisible: pin.label_visible ?? true,
      projectId: pin.project_id || undefined,
      userId: pin.user_id
    }));
  }

  /**
   * Get all areas for a specific project
   */
  async getProjectAreas(projectId: string): Promise<Area[]> {
    const { data: { user } } = await this.supabase.auth.getUser();
    if (!user) {
      console.warn('[PinAreaService] User not authenticated');
      return [];
    }

    // Let RLS handle access control - no user_id filter needed
    const { data, error } = await this.supabase
      .from('areas')
      .select('*')
      .eq('project_id', projectId);

    if (error) {
      console.error('[PinAreaService] Error fetching project areas:', error);
      throw error;
    }

    return (data || []).map(area => ({
      id: area.id,
      path: area.path as { lat: number; lng: number }[],
      label: area.label,
      notes: area.notes || undefined,
      labelVisible: area.label_visible ?? true,
      fillVisible: area.fill_visible ?? true,
      projectId: area.project_id || undefined,
      userId: area.user_id
    }));
  }

  /**
   * Get both pins and areas for a project in a single call
   */
  async getProjectObjects(projectId: string): Promise<{ pins: Pin[]; areas: Area[] }> {
    const [pins, areas] = await Promise.all([
      this.getProjectPins(projectId),
      this.getProjectAreas(projectId)
    ]);

    return { pins, areas };
  }
}

export const pinAreaService = new PinAreaService();

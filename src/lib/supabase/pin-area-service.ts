import { createClient } from './client';
import { Pin, Area } from './types';

class PinAreaService {
  private supabase = createClient();

  // Check if current user has PEBL admin role (can see all data)
  private async isPeblAdmin(userId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('user_profiles')
      .select('account_role')
      .eq('id', userId)
      .single();

    return data?.account_role === 'pebl';
  }

  /**
   * Get all pins for a specific project
   */
  async getProjectPins(projectId: string): Promise<Pin[]> {
    const { data: { user } } = await this.supabase.auth.getUser();
    if (!user) {
      console.warn('[PinAreaService] User not authenticated');
      return [];
    }

    // Check if user is PEBL admin (can see all pins)
    const isPebl = await this.isPeblAdmin(user.id);

    let query = this.supabase
      .from('pins')
      .select('*')
      .eq('project_id', projectId);

    // Only filter by user_id if not a PEBL admin
    if (!isPebl) {
      query = query.eq('user_id', user.id);
    }

    const { data, error } = await query;

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

    // Check if user is PEBL admin (can see all areas)
    const isPebl = await this.isPeblAdmin(user.id);

    let query = this.supabase
      .from('areas')
      .select('*')
      .eq('project_id', projectId);

    // Only filter by user_id if not a PEBL admin
    if (!isPebl) {
      query = query.eq('user_id', user.id);
    }

    const { data, error } = await query;

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

export interface KeycloakUser {
  email: string | null;
  phone: string | null;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
}

export class KeycloakClient {
  private baseUrl: string;
  private adminUser: string;
  private adminPassword: string;
  private token: string | null = null;

  constructor() {
    this.baseUrl = process.env.KEYCLOAK_URL!;
    this.adminUser = process.env.PROD_KEYCLOAK_ADMIN_USER!;
    this.adminPassword = process.env.PROD_KEYCLOAK_ADMIN_PASSWORD!;

    if (!this.baseUrl || !this.adminUser || !this.adminPassword) {
      throw new Error('Missing Keycloak environment variables');
    }
  }

  async getAdminToken(): Promise<string> {
    if (this.token) {
      return this.token;
    }

    const tokenUrl = `${this.baseUrl}/realms/master/protocol/openid-connect/token`;
    
    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          username: this.adminUser,
          password: this.adminPassword,
          client_id: 'admin-cli',
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to get Keycloak token: ${response.status} ${response.statusText}`);
      }

      const tokenData = await response.json();
      this.token = tokenData.access_token;
      return this.token;
      
    } catch (error) {
      console.error("Failed to get Keycloak admin token:", error);
      throw error;
    }
  }

  async findUserByName(fio: string): Promise<KeycloakUser> {
    const token = await this.getAdminToken();
    
    const names = fio.split(' ').filter(Boolean);
    if (names.length === 0) {
      return { email: null, phone: null };
    }

    const lastName = names[0];
    const firstName = names.length > 1 ? names[1] : '';

    let query = `search=${encodeURIComponent(lastName)}`;
    if (firstName) {
      query += ` ${encodeURIComponent(firstName)}`;
    }

    const usersUrl = `${this.baseUrl}/admin/realms/cde/users?${query}`;

    try {
      const response = await fetch(usersUrl, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        return { email: null, phone: null };
      }

      const users = await response.json();
      if (users.length > 0) {
        const user = users[0];
        const phone = user.attributes?.phone?.[0] || null;
        return { 
          email: user.email || null, 
          phone,
          firstName: user.firstName || null,
          lastName: user.lastName || null,
          username: user.username || null
        };
      }
    } catch (error) {
      console.error(`Error finding user '${fio}' in Keycloak:`, error);
    }

    return { email: null, phone: null, firstName: null, lastName: null, username: null };
  }

  async findUserById(userId: string): Promise<KeycloakUser> {
    const token = await this.getAdminToken();
    
    if (!userId) {
      return { email: null, phone: null, firstName: null, lastName: null, username: null };
    }

    const userUrl = `${this.baseUrl}/admin/realms/cde/users/${encodeURIComponent(userId)}`;

    try {
      const response = await fetch(userUrl, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        return { email: null, phone: null, firstName: null, lastName: null, username: null };
      }

      const user = await response.json();
      const phone = user.attributes?.phone?.[0] || null;
      return { 
        email: user.email || null, 
        phone,
        firstName: user.firstName || null,
        lastName: user.lastName || null,
        username: user.username || null
      };
    } catch (error) {
      console.error(`Error finding user by ID '${userId}' in Keycloak:`, error);
    }

    return { email: null, phone: null, firstName: null, lastName: null, username: null };
  }

  clearToken(): void {
    this.token = null;
  }
}
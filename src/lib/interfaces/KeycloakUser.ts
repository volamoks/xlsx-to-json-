export interface KeycloakUserRepresentation {
  id?: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  emailVerified?: boolean;
  attributes?: { [key: string]: string[] };
  groups?: string[];
  roles?: string[];
}
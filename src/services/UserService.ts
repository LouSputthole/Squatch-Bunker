import { v4 as uuidv4 } from 'uuid';
import { User } from '../models/User';

class UserService {
  private users: Map<string, User> = new Map();

  register(username: string): User {
    const user: User = {
      id: uuidv4(),
      username,
      createdAt: Date.now(),
    };
    this.users.set(user.id, user);
    return user;
  }

  getUser(id: string): User | undefined {
    return this.users.get(id);
  }
}

export const userService = new UserService();

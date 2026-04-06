import { Router, Request, Response } from 'express';
import { userService } from '../services/UserService';

const router = Router();

// POST /api/users/register
router.post('/register', (req: Request, res: Response) => {
  const { username } = req.body as { username?: string };

  if (!username || username.trim().length === 0) {
    res.status(400).json({ error: 'username is required' });
    return;
  }

  const trimmed = username.trim().slice(0, 32);
  const user = userService.register(trimmed);
  res.status(201).json({ userId: user.id, username: user.username });
});

// GET /api/users/:id
router.get('/:id', (req: Request, res: Response) => {
  const user = userService.getUser(req.params.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(user);
});

export default router;

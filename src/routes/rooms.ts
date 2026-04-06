import { Router, Request, Response } from 'express';
import { roomService } from '../services/RoomService';
import { presenceService } from '../services/PresenceService';
import { RoomType } from '../models/Room';

const router = Router();

// GET /api/rooms?serverId=default
router.get('/', (req: Request, res: Response) => {
  const serverId = (req.query.serverId as string) || 'default';
  const rooms = roomService.getRoomsByServer(serverId);
  const result = rooms.map(room => {
    const members = presenceService.getRoomPresence(room.id);
    return {
      ...room,
      occupancy: members.length,
    };
  });
  res.json(result);
});

// GET /api/rooms/:id
router.get('/:id', (req: Request, res: Response) => {
  const room = roomService.getRoom(req.params.id);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  const members = presenceService.getRoomPresence(room.id);
  res.json({ ...room, members });
});

// POST /api/rooms
router.post('/', (req: Request, res: Response) => {
  const { name, serverId, type, capacity } = req.body as {
    name?: string;
    serverId?: string;
    type?: RoomType;
    capacity?: number;
  };

  if (!name || !serverId) {
    res.status(400).json({ error: 'name and serverId are required' });
    return;
  }

  const room = roomService.createRoom({ name, serverId, type, capacity });
  res.status(201).json(room);
});

// DELETE /api/rooms/:id
router.delete('/:id', (req: Request, res: Response) => {
  const deleted = roomService.deleteRoom(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  res.status(204).send();
});

export default router;

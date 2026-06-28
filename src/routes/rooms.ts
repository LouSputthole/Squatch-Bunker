import { Router, Request, Response } from 'express';
import { Server as SocketServer } from 'socket.io';
import { roomService } from '../services/RoomService';
import { presenceService } from '../services/PresenceService';
import { chatService } from '../services/ChatService';
import { RoomType } from '../models/Room';

const router = Router();

const VALID_TYPES: RoomType[] = ['voice', 'stage', 'private_voice'];
const MAX_ROOMS_PER_SERVER = 50;
const MAX_NAME_LEN = 64;
const MAX_CAPACITY = 99;

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
  const body = (req.body ?? {}) as Record<string, unknown>;

  // name: required non-empty string, trimmed and length-capped
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    res.status(400).json({ error: 'name must be a non-empty string' });
    return;
  }
  const name = body.name.trim().slice(0, MAX_NAME_LEN);

  // serverId: required non-empty string
  if (typeof body.serverId !== 'string' || body.serverId.trim().length === 0) {
    res.status(400).json({ error: 'serverId must be a non-empty string' });
    return;
  }
  const serverId = body.serverId.trim().slice(0, MAX_NAME_LEN);

  // type: optional, must be a known RoomType (defaults to 'voice')
  let type: RoomType | undefined;
  if (body.type !== undefined) {
    if (typeof body.type !== 'string' || !VALID_TYPES.includes(body.type as RoomType)) {
      res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
      return;
    }
    type = body.type as RoomType;
  }

  // capacity: optional non-negative integer within bounds (0 = unlimited)
  let capacity: number | undefined;
  if (body.capacity !== undefined) {
    if (
      typeof body.capacity !== 'number' ||
      !Number.isInteger(body.capacity) ||
      body.capacity < 0 ||
      body.capacity > MAX_CAPACITY
    ) {
      res.status(400).json({ error: `capacity must be an integer between 0 and ${MAX_CAPACITY}` });
      return;
    }
    capacity = body.capacity;
  }

  // Guard against unbounded room creation per server
  if (roomService.getRoomsByServer(serverId).length >= MAX_ROOMS_PER_SERVER) {
    res.status(429).json({ error: 'Too many channels on this server' });
    return;
  }

  const room = roomService.createRoom({ name, serverId, type, capacity });

  // Announce the new room so other clients' sidebars stay in sync
  const io = req.app.get('io') as SocketServer | undefined;
  io?.to('lobby').emit('room:created', { room });

  res.status(201).json(room);
});

// DELETE /api/rooms/:id
router.delete('/:id', (req: Request, res: Response) => {
  const roomId = req.params.id;
  const deleted = roomService.deleteRoom(roomId);
  if (!deleted) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }

  // Clean up associated state and notify/evict any connected members.
  const members = presenceService.removeRoom(roomId);
  chatService.clearRoom(roomId);

  const io = req.app.get('io') as SocketServer | undefined;
  if (io) {
    io.to(`room:${roomId}`).emit('room:deleted', { roomId });
    io.to('lobby').emit('lobby:room-update', { roomId, members: [] });
    io.to('lobby').emit('room:deleted', { roomId });
    // Force any sockets still in the room channel to leave it.
    for (const member of members) {
      io.sockets.sockets.get(member.socketId)?.leave(`room:${roomId}`);
    }
  }

  res.status(204).send();
});

export default router;

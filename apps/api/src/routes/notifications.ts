import { Hono } from 'hono'
import { env } from 'hono/adapter'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import type { AuthVariables } from '../middleware/auth.js'
import type { DbVariables } from '../middleware/db.js'
import {
  listNotifications,
  createNotification,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  sendEmail,
} from '../controllers/notifications.controller.js'

// Define the environment variables and context type for our Hono Router
type NotificationsEnv = {
  Bindings: { DATABASE_URL: string }
  Variables: DbVariables & AuthVariables
}

// Zod schema to validate request body for sending simulated email
const sendEmailSchema = z.object({
  studentEmail: z.string().email('Invalid student email format'),
  postingTitle: z.string().min(1, 'Posting title is required'),
  companyName: z.string().min(1, 'Company name is required'),
  status: z.enum(['applied', 'under_review', 'shortlisted', 'accepted', 'rejected']),
})

// Zod schema to validate notification creation payload
const createNotificationSchema = z.object({
  userId: z.string().uuid('Invalid user ID format'),
  type: z.enum([
    'new_matching_posting',
    'application_received',
    'status_changed',
    'verification_result',
    'recruiter_approved',
    'admin_queue_reminder',
  ]),
  payload: z.record(z.string(), z.any()).default({}),
})

const notificationsRouter = new Hono<NotificationsEnv>()

/**
 * Endpoint to simulate email dispatch.
 * Does not strictly require JWT login in order to allow internal services or system scripts to send emails.
 */
notificationsRouter.post('/send-email', zValidator('json', sendEmailSchema), async (c) => {
  const { studentEmail, postingTitle, companyName, status } = c.req.valid('json')

  // Read Resend API Key from Cloudflare Worker environment bindings
  const bindings = env<{ RESEND_API_KEY?: string }>(c)

  const result = await sendEmail(
    bindings.RESEND_API_KEY,
    studentEmail,
    postingTitle,
    companyName,
    status,
  )
  return c.json({ data: result })
})

// All routes declared below this line will require a verified Authorization token
notificationsRouter.use('*', requireAuth)

/**
 * GET /api/notifications
 * Lists all notifications for the authenticated user.
 */
notificationsRouter.get('/', async (c) => {
  const db = c.var.db
  const authUser = c.var.authUser // Populated by requireAuth middleware

  const data = await listNotifications(db, authUser.id)
  return c.json({ data })
})

/**
 * POST /api/notifications
 * Creates a notification record for a specific user.
 */
notificationsRouter.post('/', zValidator('json', createNotificationSchema), async (c) => {
  const db = c.var.db
  const input = c.req.valid('json')

  const data = await createNotification(db, input)
  if (!data) {
    return c.json({ error: 'Failed to create notification' }, 500)
  }
  return c.json({ data })
})

/**
 * PATCH /api/notifications/:id/read
 * Marks a specific notification as read.
 */
notificationsRouter.patch('/:id/read', async (c) => {
  const db = c.var.db
  const authUser = c.var.authUser
  const id = c.req.param('id')

  // Basic UUID check
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(id)) {
    return c.json({ error: 'Notification not found' }, 404)
  }

  const data = await markNotificationAsRead(db, authUser.id, id)
  if (!data) {
    return c.json({ error: 'Notification not found' }, 404)
  }
  return c.json({ data })
})

/**
 * POST /api/notifications/read-all
 * Marks all notifications of the authenticated user as read.
 */
notificationsRouter.post('/read-all', async (c) => {
  const db = c.var.db
  const authUser = c.var.authUser

  const data = await markAllNotificationsAsRead(db, authUser.id)
  return c.json({ data })
})

export { notificationsRouter }

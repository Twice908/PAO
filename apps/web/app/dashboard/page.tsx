import { redirect } from 'next/navigation'

// PAO standalone only ships the Agents views — send the dashboard root there.
export default function DashboardIndex() {
  redirect('/dashboard/agents')
}

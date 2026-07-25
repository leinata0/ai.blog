import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import '@testing-library/jest-dom/vitest'

import {
  AdminConfirmProvider,
  useAdminConfirm,
} from '../src/components/admin/AdminConfirmDialog'

function ConfirmHarness() {
  const confirm = useAdminConfirm()

  async function requestDelete() {
    const accepted = await confirm({
      title: '删除文章',
      description: '文章和管理记录会永久删除。',
      confirmLabel: '删除文章',
    })
    document.querySelector('[data-result]').textContent = accepted ? 'confirmed' : 'cancelled'
  }

  return (
    <>
      <button type="button" onClick={requestDelete}>打开确认</button>
      <output data-result />
    </>
  )
}

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

describe('AdminConfirmProvider', () => {
  it('locks the page, closes with Escape, and restores trigger focus', async () => {
    const user = userEvent.setup()
    render(
      <AdminConfirmProvider>
        <ConfirmHarness />
      </AdminConfirmProvider>,
    )

    const trigger = screen.getByRole('button', { name: '打开确认' })
    await user.click(trigger)

    expect(screen.getByRole('dialog', { name: '删除文章' })).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.body.style.overflow).toBe('')
    expect(trigger).toHaveFocus()
    expect(screen.getByText('cancelled')).toBeInTheDocument()
  })

  it('resolves true only from the explicit confirm action', async () => {
    const user = userEvent.setup()
    render(
      <AdminConfirmProvider>
        <ConfirmHarness />
      </AdminConfirmProvider>,
    )

    await user.click(screen.getByRole('button', { name: '打开确认' }))
    await user.click(screen.getByRole('button', { name: '删除文章' }))

    expect(await screen.findByText('confirmed')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

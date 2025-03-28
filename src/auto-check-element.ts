import {debounce} from '@github/mini-throttle'

type Controller =
  | AbortController
  | {
      signal: AbortSignal | null
      abort: () => void
    }

type State = {
  check: (event: Event) => unknown
  controller: Controller | null
}

enum AllowedHttpMethods {
  GET = 'GET',
  POST = 'POST',
}

const states = new WeakMap<AutoCheckElement, State>()

class AutoCheckEvent extends Event {
  constructor(public readonly phase: string) {
    super(`auto-check-${phase}`, {bubbles: true})
  }

  // Backwards compatibility with `CustomEvent`
  get detail() {
    return this
  }
}

class AutoCheckValidationEvent extends AutoCheckEvent {
  constructor(public readonly phase: string, public message = '') {
    super(phase)
  }

  setValidity = (message: string) => {
    this.message = message
  }
}

// eslint-disable-next-line custom-elements/no-exports-with-element
export class AutoCheckCompleteEvent extends AutoCheckEvent {
  constructor() {
    super('complete')
  }
}

// eslint-disable-next-line custom-elements/no-exports-with-element
export class AutoCheckSuccessEvent extends AutoCheckEvent {
  constructor(public readonly response: Response) {
    super('success')
  }
}

// eslint-disable-next-line custom-elements/no-exports-with-element
export class AutoCheckStartEvent extends AutoCheckValidationEvent {
  constructor() {
    super('start', 'Verifying…')
  }
}

// eslint-disable-next-line custom-elements/no-exports-with-element
export class AutoCheckErrorEvent extends AutoCheckValidationEvent {
  constructor(public readonly response: Response) {
    // eslint-disable-next-line i18n-text/no-en
    super('error', 'Validation failed')
  }
}

// eslint-disable-next-line custom-elements/no-exports-with-element
export class AutoCheckSendEvent extends AutoCheckEvent {
  constructor(public readonly body: FormData) {
    super('send')
  }
}

export class AutoCheckElement extends HTMLElement {
  static define(tag = 'auto-check', registry = customElements) {
    registry.define(tag, this)
    return this
  }

  #onloadend: ((event: Event) => void) | null = null
  get onloadend() {
    return this.#onloadend
  }

  set onloadend(listener: ((event: Event) => void) | null) {
    if (this.#onloadend) {
      this.removeEventListener('loadend', this.#onloadend as unknown as EventListenerOrEventListenerObject)
    }
    this.#onloadend = typeof listener === 'object' || typeof listener === 'function' ? listener : null
    if (typeof listener === 'function') {
      this.addEventListener('loadend', listener as unknown as EventListenerOrEventListenerObject)
    }
  }

  connectedCallback(): void {
    const input = this.input
    if (!input) return

    const checker = debounce(check.bind(null, this), 300)
    const state = {check: checker, controller: null}
    states.set(this, state)

    const changeHandler = handleChange.bind(null, checker)

    input.addEventListener('blur', changeHandler)
    input.addEventListener('input', changeHandler)
    input.addEventListener('triggervalidation', changeHandler)
    input.autocomplete = 'off'
    input.spellcheck = false
  }

  disconnectedCallback(): void {
    const input = this.input
    if (!input) return

    const state = states.get(this)
    if (!state) return
    states.delete(this)

    input.removeEventListener('input', setLoadingState)
    input.removeEventListener('input', state.check)
    input.setCustomValidity('')
  }

  attributeChangedCallback(name: string): void {
    if (name === 'required') {
      const input = this.input
      if (!input) return
      input.required = this.required
    }
  }

  triggerValidation(): void {
    const input = this.input
    if (!input) return

    input.dispatchEvent(new CustomEvent('triggervalidation'))
  }

  static get observedAttributes(): string[] {
    return ['required']
  }

  get input(): HTMLInputElement | null {
    return this.querySelector('input')
  }

  get src(): string {
    const src = this.getAttribute('src')
    if (!src) return ''

    const link = this.ownerDocument!.createElement('a')
    link.href = src
    return link.href
  }

  set src(value: string) {
    this.setAttribute('src', value)
  }

  get csrf(): string {
    const csrfElement = this.querySelector('[data-csrf]')
    return this.getAttribute('csrf') || (csrfElement instanceof HTMLInputElement && csrfElement.value) || ''
  }

  set csrf(value: string) {
    this.setAttribute('csrf', value)
  }

  get required(): boolean {
    return this.hasAttribute('required')
  }

  set required(required: boolean) {
    if (required) {
      this.setAttribute('required', '')
    } else {
      this.removeAttribute('required')
    }
  }

  get csrfField(): string {
    return this.getAttribute('csrf-field') || 'authenticity_token'
  }

  set csrfField(value: string) {
    this.setAttribute('csrf-field', value)
  }

  get httpMethod(): string {
    return AllowedHttpMethods[this.getAttribute('http-method') as keyof typeof AllowedHttpMethods] || 'POST'
  }

  set validateOnKeystroke(enabled: boolean) {
    if (enabled) {
      this.setAttribute('validate-on-keystroke', '')
    } else {
      this.removeAttribute('validate-on-keystroke')
    }
  }

  get validateOnKeystroke(): boolean {
    const value = this.getAttribute('validate-on-keystroke')
    return value === 'true' || value === ''
  }
}

function handleChange(checker: () => void, event: Event) {
  const input = event.currentTarget
  if (!(input instanceof HTMLInputElement)) return

  const autoCheckElement = input.closest('auto-check')
  if (!(autoCheckElement instanceof AutoCheckElement)) return

  if (event.type === 'input') {
    autoCheckElement.setAttribute('dirty', '')
  }

  if (input.value.length === 0) return

  if (
    (event.type === 'blur' && !autoCheckElement.validateOnKeystroke && autoCheckElement.hasAttribute('dirty')) || // Only validate on blur if input is dirty and input is not current validating on keystroke
    (event.type === 'input' && autoCheckElement.validateOnKeystroke) || // Only validate on key inputs if validate-on-keystroke is set (when input is invalid)
    event.type === 'triggervalidation' // Trigger validation manually
  ) {
    setLoadingState(event)
    checker()
  }
}

function setLoadingState(event: Event) {
  const input = event.currentTarget
  if (!(input instanceof HTMLInputElement)) return

  const autoCheckElement = input.closest('auto-check')
  if (!(autoCheckElement instanceof AutoCheckElement)) return

  const src = autoCheckElement.src
  const csrf = autoCheckElement.csrf
  const httpMethod = autoCheckElement.httpMethod
  const state = states.get(autoCheckElement)

  // If some attributes are missing we want to exit early and make sure that the element is valid.
  if (!src || (httpMethod === 'POST' && !csrf) || !state) {
    return
  }

  const startEvent = new AutoCheckStartEvent()
  input.dispatchEvent(startEvent)
  if (autoCheckElement.required) {
    input.setCustomValidity(startEvent.message)
  }
}

function makeAbortController() {
  if ('AbortController' in window) {
    return new AbortController()
  }
  return {
    signal: null,
    abort() {
      // Do nothing
    },
  }
}

async function fetchWithNetworkEvents(el: Element, url: string, options: RequestInit): Promise<Response> {
  if (options.method === 'GET') {
    delete options.body
  }
  try {
    const response = await fetch(url, options)
    el.dispatchEvent(new Event('load'))
    el.dispatchEvent(new Event('loadend'))
    return response
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      el.dispatchEvent(new Event('error'))
      el.dispatchEvent(new Event('loadend'))
    }
    throw error
  }
}

async function check(autoCheckElement: AutoCheckElement) {
  const input = autoCheckElement.input
  if (!input) {
    return
  }

  const csrfField = autoCheckElement.csrfField
  const src = autoCheckElement.src
  const csrf = autoCheckElement.csrf
  const state = states.get(autoCheckElement)
  const httpMethod = autoCheckElement.httpMethod

  // If some attributes are missing we want to exit early and make sure that the element is valid.
  if (!src || (httpMethod === 'POST' && !csrf) || !state) {
    if (autoCheckElement.required) {
      input.setCustomValidity('')
    }
    return
  }

  if (!input.value.trim()) {
    if (autoCheckElement.required) {
      input.setCustomValidity('')
    }
    return
  }

  const body = new FormData()
  const url = new URL(src, window.location.origin)
  if (httpMethod === 'POST') {
    body.append(csrfField, csrf)
    body.append('value', input.value)
  } else {
    url.search = new URLSearchParams({value: input.value}).toString()
  }

  input.dispatchEvent(new AutoCheckSendEvent(body))

  if (state.controller) {
    state.controller.abort()
  } else {
    autoCheckElement.dispatchEvent(new Event('loadstart'))
  }

  state.controller = makeAbortController()

  autoCheckElement.removeAttribute('dirty')

  try {
    const response = await fetchWithNetworkEvents(autoCheckElement, url.toString(), {
      credentials: 'same-origin',
      signal: state.controller.signal,
      method: httpMethod,
      body,
    })
    if (response.ok) {
      if (autoCheckElement.required) {
        input.setCustomValidity('')
      }
      // We do not have good test coverage for this code path.
      // To test, ensure that the input only validates on blur
      // once it has been "healed" by a valid input after
      // previously being in an invalid state.
      autoCheckElement.validateOnKeystroke = false
      input.dispatchEvent(new AutoCheckSuccessEvent(response.clone()))
    } else {
      autoCheckElement.validateOnKeystroke = true
      const event = new AutoCheckErrorEvent(response.clone())
      input.dispatchEvent(event)
      if (autoCheckElement.required) {
        input.setCustomValidity(event.message)
      }
    }
    state.controller = null
    input.dispatchEvent(new AutoCheckCompleteEvent())
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      state.controller = null
      input.dispatchEvent(new AutoCheckCompleteEvent())
    }
  }
}

export default AutoCheckElement

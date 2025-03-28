import {assert} from '@open-wc/testing'
import {AutoCheckElement} from '../src/index.ts'

describe('auto-check element', function () {
  describe('element creation', function () {
    it('creates from document.createElement', function () {
      const el = document.createElement('auto-check')
      assert.equal('AUTO-CHECK', el.nodeName)
      assert.ok(el instanceof AutoCheckElement)
    })

    it('creates from constructor', function () {
      const el = new window.AutoCheckElement()
      assert.equal('AUTO-CHECK', el.nodeName)
      assert.ok(el instanceof AutoCheckElement)
    })

    it('has the correct attributes', function () {
      const el = document.createElement('auto-check')
      assert.equal(el.getAttribute('autocomplete', 'off'))
      assert.equal(el.getAttribute('spellcheck', 'false'))
    })
  })

  describe('blur event functionality', function () {
    let checker
    let input

    beforeEach(function () {
      const container = document.createElement('div')
      container.innerHTML = `
        <auto-check csrf="foo" src="/success">
          <input>
        </auto-check>`
      document.body.append(container)

      checker = document.querySelector('auto-check')
      input = checker.querySelector('input')
    })

    it('does not emit on initial input change', async function () {
      const events = []
      input.addEventListener('auto-check-start', event => events.push(event.type))
      triggerInput(input, 'hub')
      assert.deepEqual(events, [])
    })

    it('does not emit on blur if input is blank', async function () {
      const events = []
      input.addEventListener('auto-check-start', event => events.push(event.type))
      triggerBlur(input)
      assert.deepEqual(events, [])
    })

    it('emits on blur', async function () {
      const events = []
      input.addEventListener('auto-check-start', event => events.push(event.type))
      triggerInput(input, 'hub')
      triggerBlur(input)
      assert.deepEqual(events, ['auto-check-start'])
    })

    it('does not emit on blur if input has not changed after initial blur', async function () {
      const events = []
      input.addEventListener('auto-check-start', event => events.push(event.type))
      triggerInput(input, 'hub')
      triggerBlur(input)

      await once(input, 'auto-check-complete')
      triggerBlur(input)

      assert.deepEqual(events, ['auto-check-start'])
    })

    it('emits on input change if input is invalid after blur', async function () {
      const events = []
      input.addEventListener('auto-check-start', event => events.push(event.type))

      checker.src = '/fail'
      triggerInput(input, 'hub')
      triggerBlur(input)
      await once(input, 'auto-check-complete')
      triggerInput(input, 'hub2')
      triggerInput(input, 'hub3')

      assert.deepEqual(events, ['auto-check-start', 'auto-check-start', 'auto-check-start'])
    })

    it('does not emit on blur if input is invalid', async function () {
      const events = []
      input.addEventListener('auto-check-start', event => events.push(event.type))

      checker.src = '/fail'
      triggerInput(input, 'hub')
      triggerBlur(input)
      await once(input, 'auto-check-complete')

      triggerInput(input, 'hub2')
      triggerBlur(input)

      triggerInput(input, 'hub3')

      assert.deepEqual(events, ['auto-check-start', 'auto-check-start', 'auto-check-start'])
    })

    afterEach(function () {
      document.body.innerHTML = ''
      checker = null
      input = null
    })
  })

  describe('required attribute', function () {
    let checker
    let input

    beforeEach(function () {
      const container = document.createElement('div')
      container.innerHTML = `
        <auto-check csrf="foo" src="/success" required>
          <input>
        </auto-check>`
      document.body.append(container)

      checker = document.querySelector('auto-check')
      input = checker.querySelector('input')
    })

    afterEach(function () {
      document.body.innerHTML = ''
      checker = null
      input = null
    })

    it('invalidates empty input', function () {
      assert.isTrue(input.hasAttribute('required'))
      assert.isFalse(input.checkValidity())
    })

    it('invalidates the input element on blur', async function () {
      const inputEvent = once(input, 'input')
      triggerInput(input, 'hub')
      triggerBlur(input)
      await inputEvent
      assert.isFalse(input.checkValidity())
    })

    it('invalidates input request is in-flight', async function () {
      triggerInput(input, 'hub')
      triggerBlur(input)
      await once(checker, 'loadstart')
      assert.isFalse(input.checkValidity())
    })

    it('invalidates input with failed server response', async function () {
      checker.src = '/fail'
      triggerInput(input, 'hub')
      triggerBlur(input)
      await once(input, 'auto-check-complete')
      assert.isFalse(input.checkValidity())
    })

    it('validates input with successful server response', async function () {
      triggerInput(input, 'hub')
      triggerBlur(input)
      await once(input, 'auto-check-complete')
      assert.isTrue(input.checkValidity())
    })

    it('customizes the in-flight message', async function () {
      checker.src = '/fail'
      const send = new Promise(resolve => {
        input.addEventListener('auto-check-start', event => {
          event.detail.setValidity('Checking with server')
          resolve()
        })
        triggerInput(input, 'hub')
        triggerBlur(input)
      })
      await send
      assert(!input.validity.valid)
      assert.equal('Checking with server', input.validationMessage)
    })

    it('customizes the error message', async function () {
      checker.src = '/fail'
      const error = new Promise(resolve => {
        input.addEventListener('auto-check-error', event => {
          event.detail.setValidity('A custom error')
          resolve()
        })
        triggerInput(input, 'hub')
        triggerBlur(input)
      })
      await error
      assert(!input.validity.valid)
      assert.equal('A custom error', input.validationMessage)
    })

    it('skips validation if required attribute is not present', async function () {
      checker.src = '/fail'
      checker.required = false
      input.value = 'hub'
      assert.isTrue(input.checkValidity())
      input.dispatchEvent(new InputEvent('input'))
      triggerBlur(input)
      await once(input, 'auto-check-complete')
      assert.isTrue(input.checkValidity())
    })
  })

  describe('manually triggering validation', function () {
    let checker
    let input

    beforeEach(function () {
      const container = document.createElement('div')
      container.innerHTML = `
        <auto-check csrf="foo" src="/success" required>
          <input id="input-field" value="hub">
        </auto-check>`
      document.body.append(container)

      checker = document.querySelector('auto-check')
      input = checker.querySelector('input')
    })

    it('emits on manual trigger', async function () {
      const events = []
      input.addEventListener('auto-check-start', event => events.push(event.type))

      document.getElementById('input-field').closest('auto-check').triggerValidation()

      assert.deepEqual(events, ['auto-check-start'])
    })

    it('does not emit on manual trigger if input is empty', async function () {
      const events = []
      input.addEventListener('auto-check-start', event => events.push(event.type))

      input.value = ''
      document.getElementById('input-field').closest('auto-check').triggerValidation()

      assert.deepEqual(events, [])
    })

    afterEach(function () {
      document.body.innerHTML = ''
      checker = null
      input = null
    })
  })

  describe('using HTTP GET', function () {
    let checker
    let input

    beforeEach(function () {
      const container = document.createElement('div')
      container.innerHTML = `
        <auto-check src="/success" http-method="GET" required>
          <input>
        </auto-check>`
      document.body.append(container)

      checker = document.querySelector('auto-check')
      input = checker.querySelector('input')
    })

    afterEach(function () {
      document.body.innerHTML = ''
      checker = null
      input = null
    })

    it('validates input with successful server response with GET', async function () {
      triggerInput(input, 'hub')
      triggerBlur(input)
      await once(input, 'auto-check-complete')
      assert.isTrue(input.checkValidity())
    })
  })

  describe('network lifecycle events', function () {
    let checker
    let input

    beforeEach(function () {
      const container = document.createElement('div')
      container.innerHTML = `
        <auto-check csrf="foo" src="/success">
          <input>
        </auto-check>`
      document.body.append(container)

      checker = document.querySelector('auto-check')
      input = checker.querySelector('input')
    })

    afterEach(function () {
      document.body.innerHTML = ''
      checker = null
      input = null
    })

    it('emits network events in order', async function () {
      const events = []
      const track = event => events.push(event.type)

      checker.addEventListener('loadstart', track)
      checker.addEventListener('load', track)
      checker.addEventListener('error', track)
      checker.addEventListener('loadend', track)

      const completed = Promise.all([once(checker, 'loadstart'), once(checker, 'load'), once(checker, 'loadend')])
      triggerInput(input, 'hub')
      triggerBlur(input)
      await completed

      assert.deepEqual(['loadstart', 'load', 'loadend'], events)
    })

    it('can use setters', async function () {
      const events = []
      const track = event => events.push(event.type)

      checker.onloadstart = track
      checker.onload = track
      checker.onerror = track
      checker.onloadend = track

      const completed = Promise.all([once(checker, 'loadstart'), once(checker, 'load'), once(checker, 'loadend')])
      triggerInput(input, 'hub')
      triggerBlur(input)
      await completed

      assert.deepEqual(['loadstart', 'load', 'loadend'], events)
    })
  })

  describe('auto-check lifecycle events', function () {
    let checker
    let input

    beforeEach(function () {
      const container = document.createElement('div')
      container.innerHTML = `
        <auto-check csrf="foo" src="/success">
          <input>
        </auto-check>`
      document.body.append(container)

      checker = document.querySelector('auto-check')
      input = checker.querySelector('input')
    })

    afterEach(function () {
      document.body.innerHTML = ''
      checker = null
      input = null
    })

    it('emits auto-check-send on blur', function (done) {
      input.addEventListener('auto-check-send', () => done())
      input.value = 'hub'
      input.dispatchEvent(new InputEvent('input'))
      triggerBlur(input)
    })

    it('emits auto-check-start on input', function (done) {
      input.addEventListener('auto-check-start', () => done())
      input.value = 'hub'
      input.dispatchEvent(new InputEvent('input'))
      triggerBlur(input)
    })

    it('emits auto-check-send 300 milliseconds after blur', function (done) {
      input.addEventListener('auto-check-send', () => done())
      input.value = 'hub'
      input.dispatchEvent(new InputEvent('input'))
      triggerBlur(input)
    })

    it('emits auto-check-success when server responds with 200 OK', async function () {
      triggerInput(input, 'hub')
      triggerBlur(input)
      const event = await once(input, 'auto-check-success')
      const result = await event.detail.response.text()
      assert.equal('This is a warning', result)
    })

    it('emits auto-check-error event when server returns an error response', async function () {
      checker.src = '/fail'
      triggerInput(input, 'hub')
      triggerBlur(input)
      const event = await once(input, 'auto-check-error')
      const result = await event.detail.response.text()
      assert.equal('This is an error', result)
    })

    it('emits auto-check-complete event at the end of the lifecycle', function (done) {
      input.addEventListener('auto-check-complete', () => done())
      triggerInput(input, 'hub')
      triggerBlur(input)
    })

    it('emits auto-check-send event before checking if there is a duplicate request', function (done) {
      let counter = 2
      input.addEventListener('auto-check-send', () => {
        if (counter === 2) {
          done()
        } else {
          counter += 1
        }
      })

      input.value = 'hub'
      input.dispatchEvent(new InputEvent('input'))
      triggerBlur(input)
    })

    it('do not emit if essential attributes are missing', async function () {
      const events = []
      checker.removeAttribute('src')
      input.addEventListener('auto-check-start', event => events.push(event.type))
      triggerInput(input, 'hub')
      assert.deepEqual(events, [])
    })
  })

  describe('csrf support', function () {
    afterEach(function () {
      document.body.innerHTML = ''
    })

    it('fetches CSRF tokens from attributes', function () {
      const container = document.createElement('div')
      container.innerHTML = `
        <auto-check csrf="foo" src="/success" required>
          <input>
        </auto-check>`
      document.body.append(container)
      const autoCheck = document.querySelector('auto-check')
      assert.equal(autoCheck.csrf, 'foo')
    })

    it('fetches CSRF tokens from child elements', function () {
      const container = document.createElement('div')
      container.innerHTML = `
        <auto-check src="/success" required>
          <input>
          <input type="hidden" data-csrf value="foo">
        </auto-check>`
      document.body.append(container)
      const autoCheck = document.querySelector('auto-check')
      assert.equal(autoCheck.csrf, 'foo')
    })
  })
})

function once(element, eventName) {
  return new Promise(resolve => {
    element.addEventListener(eventName, resolve, {once: true})
  })
}

function triggerInput(input, value) {
  input.value = value
  return input.dispatchEvent(new InputEvent('input'))
}

function triggerBlur(input) {
  return input.dispatchEvent(new FocusEvent('blur'))
}

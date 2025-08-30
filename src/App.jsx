import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import { collection, addDoc, getDocs } from "firebase/firestore";
import { db } from "./lib/firebase";


function App() {
  const [count, setCount] = useState(0)

async function testFirestore() {
  try {
    // Write a doc
    await addDoc(collection(db, "healthchecks"), {
      ok: true,
      at: Date.now(),
    });

    // Read docs
    const snap = await getDocs(collection(db, "healthchecks"));
    console.log("Healthcheck docs:", snap.docs.map(d => d.data()));
  } catch (err) {
    console.error("Firestore test failed:", err);
  }
}


  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.jsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
      <button onClick={testFirestore}>Test Firestore</button>
    </>
  )
}

export default App

/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

package main

import (
	"fmt"
	"net"
	"sync"
)

type IocpManager struct {
	mListenPort int // use mListenPort instead of socket for defining struct
}

func (i *IocpManager) Initialize(listenPort int) bool {
	i.mListenPort = listenPort
	return true
}

func (i *IocpManager) StartIoThreads() bool {
	return true
}

func (i *IocpManager) StartAccept(gl *GameLiftManager) {
	var wg sync.WaitGroup
	var num_player_session int

	myLogger.Println("Listening client connection on port: ", i.mListenPort)
	l, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", i.mListenPort))
	if err != nil {
		myLogger.Fatal(err)
	}

	for {
		if num_player_session == 2 {
			myLogger.Print("All Players are joined. No longer accept additional player")
			break
		}
		conn, err := l.Accept()
		if err != nil {
			myLogger.Fatal(err)
			continue
		}

		playerSession := PlayerSession{
			mClientAddr: conn.RemoteAddr(),
			mConn:       conn,
			mConnected:  0,

			mPlayerSessionId: "",
			mPlayerName:      "",
			mScore:           0,

			mGameLiftManager: gl,
		}

		wg.Add(1)
		playerSession.OnConnect(&wg)
		num_player_session++
	}
	wg.Wait()
}

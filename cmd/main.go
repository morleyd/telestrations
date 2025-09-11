// Copyright (2024 -- present) Cobalt Speech and Language, Inc.

package main

import (
	"fmt"
	"os"

	"github.com/cobaltspeech/log"

	"github.com/pocketbase/pocketbase"
)

type server struct {
	logger log.Logger

	address string
}

func main() {
	app := pocketbase.New()

	if err := app.Start(); err != nil {
		fmt.Printf("Problem running server: %v\n", err)
		os.Exit(1)
	}
}
